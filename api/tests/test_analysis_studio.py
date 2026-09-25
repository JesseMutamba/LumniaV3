"""Standalone checks against a temporary database; no external provider calls.
Run with the Lumnia API environment. Optional cryptography tests run when the
package is installed. Integrate import as app.routers.analysis_studio in repo.
"""
import base64
import importlib.util
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT=Path(__file__).resolve().parent
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import store
from app.auth import new_session
from app.schema import ContextIn,Text
from app.routers import analysis_studio as proposal


def document():
    fields=[]
    for i,(name,kind,role,unit,agg) in enumerate([('Date','date','date','date','none'),('Net revenue','number','revenue','USD','sum'),('Region','text','region','','none')]):
        fields.append({'id':f'c{i}','name':name,'kind':kind,'role':role,'unit':unit,'aggregation':agg,'dateFormat':'auto','numberFormat':'auto','confidence':1,'definition':name,'origin':'confirmed','missing':0,'invalid':0,'unique':2,'min':None,'max':None,'ambiguous':0})
    card={'id':'monthly','tool':'trend','measure':'c1','dimension':'c0','period':'month','filters':[]}
    return {'title':'Sales dashboard','table':{'id':'sales','name':'Sales','file':'sales.csv','sourceHash':'a'*64,'sheet':'CSV data','headers':['Date','Net revenue','Region'],'rows':[['2026-01-01',100,'East'],['2026-02-01',200,'West']],'sourceRows':[2,3],'sourceColumns':[0,1,2],'currencyEvidence':{'Net revenue':['USD']},'basis':'observed','preparation':{'originalRows':3,'preparedRows':2,'changes':[],'issues':[]}},'profile':{'version':1,'fingerprint':'b'*64,'domain':'sales','grain':'transaction','fields':fields,'dateField':'c0','currencyField':'','entityKeys':[],'deduplicate':False,'excludeTotals':True,'basis':'observed','confirmed':True,'issues':[]},'plan':{'version':1,'cards':[card],'planner':'rules','explanation':'Monthly net revenue.','questions':[]},'messages':[{'role':'user','text':'Show monthly revenue','at':'2026-09-10T00:00:00.000Z'}]}


def definitions():
    profile=document()['profile']
    keys={'name','kind','role','unit','aggregation','dateFormat','numberFormat','definition'}
    return {key:profile[key] for key in ['fingerprint','domain','grain','dateField','currencyField','entityKeys','basis']}|{'fields':[{k:v for k,v in f.items() if k in keys} for f in profile['fields']],'expected_version':0}


def ai_request():
    profile=document()['profile']
    keys={'id','name','kind','role','unit','aggregation','missing','invalid','unique','min','max'}
    return {'mode':'plan','question':'Add revenue by region','profile':{key:profile[key] for key in ['domain','grain','basis','confirmed']}|{'rows':2,'fields':[{k:v for k,v in f.items() if k in keys} for f in profile['fields']]},'currentCards':document()['plan']['cards']}


def valid_proposal():
    return {'domain':'sales','grain':'transaction','fields':[],'cards':[{'id':'region','tool':'breakdown','measure':'c1','dimension':'c2','filters':[]}],'action':'add','explanation':'Group the selected revenue measure by region.','questions':[]}


def test_router():
    env_keys=['LUMNIA_ADMIN_TOKEN','LUMNIA_SESSION_SECRET','LUMNIA_CREDENTIAL_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY']
    saved_env={key:os.environ.get(key) for key in env_keys}; old_db=store.DB_PATH; old_provider=proposal.provider_proposal
    for key in env_keys:
        os.environ.pop(key,None)
    os.environ['LUMNIA_ADMIN_TOKEN']='test-admin-token'
    checks=[]
    try:
        with TemporaryDirectory(prefix='general-studio-test-',dir=ROOT) as tmp:
            store.DB_PATH=Path(tmp)/'studio.sqlite'; store.init()
            for org in ('a','b'):
                store.put_org(org,org,Text(fr=org))
            # Session tests do not require password hashing; tokens are signed
            # and checked against the existing real account/session machinery.
            for username,org in [('alice','a'),('bob','a'),('carol','b')]:
                store.put_user(username,org,'test-hash','test-salt')
            def user_auth(name):
                token,_=new_session(name)
                return {'Authorization':'Bearer '+token}
            admin={'Authorization':'Bearer test-admin-token'}; alice=user_auth('alice'); bob=user_auth('bob'); carol=user_auth('carol')
            app=FastAPI();app.include_router(proposal.router,prefix='/v1')
            with TestClient(app) as client:
                base='/v1/analysis-studio'; dashboards=base+'/dashboards'; scope={'org':'a'}
                context_url=base+'/context'
                assert client.get(context_url,params=scope).status_code==401
                assert client.get(context_url,params=scope,headers=carol).status_code==404
                initial_context=client.get(context_url,params=scope,headers=alice)
                assert initial_context.headers['cache-control']=='no-store'
                assert initial_context.json()=={'ignore_sheets':[],'retain_files':True,'version':None}
                assert client.get(context_url,params=scope,headers=admin).json()==initial_context.json()
                assert client.get(dashboards,params=scope).status_code==401
                assert client.post(dashboards,params=scope,json=document()).status_code==401
                assert client.get(dashboards,params=scope,headers={'Authorization':'Bearer share-key'}).status_code==401
                assert client.get(dashboards,params=scope,headers=carol).status_code==404
                assert client.get(dashboards,headers=admin).status_code==422
                assert client.get(dashboards,params={'org':'missing'},headers=admin).status_code==404
                result=client.post(dashboards,params=scope,headers=alice,json=document())
                assert result.status_code==201,result.text
                created=result.json(); url=dashboards+'/'+created['id']; assert created['version']==1
                assert created['profile']['fields'][0]['min'] is None
                assert client.get(url,params=scope,headers=alice).json()==created
                assert client.get(url,params=scope,headers=bob).status_code==404
                assert client.get(url,params=scope,headers=admin).status_code==404
                assert client.get(url,params={'org':'b'},headers=alice).status_code==404
                listing=client.get(dashboards,params=scope,headers=alice)
                assert listing.headers['cache-control']=='no-store' and 'table' not in listing.json()[0]
                assert client.put(url,params=scope,headers=alice,json=document()).status_code==422
                def writer(n):
                    body=document();body.update(expected_version=1,title=f'Edit {n}')
                    return client.put(url,params=scope,headers=alice,json=body)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    responses=list(pool.map(writer,[1,2]))
                assert sorted(r.status_code for r in responses)==[200,409],[r.text for r in responses]
                winner=next(r.json() for r in responses if r.status_code==200)
                assert winner['version']==2 and client.get(url,params=scope,headers=alice).json()==winner
                assert 'expected_version' not in winner
                checks.append('authenticated owner/org CRUD and concurrent dashboard CAS')

                def invalid(mutate):
                    body=document();mutate(body)
                    response=client.post(dashboards,params=scope,headers=alice,content=json.dumps(body))
                    assert response.status_code==422,response.text
                    assert 'input' not in response.json()['detail'][0]
                invalid(lambda d:d.update(owner='author:primary'))
                invalid(lambda d:d.update(title=' '))
                invalid(lambda d:d['profile'].update(version=True))
                invalid(lambda d:d['profile'].update(confirmed=False))
                invalid(lambda d:d['profile'].update(dateField='c99'))
                invalid(lambda d:d['profile']['fields'][1].update(id='c99'))
                invalid(lambda d:d['table']['rows'][0].__setitem__(1,True))
                invalid(lambda d:d['table']['rows'][0].__setitem__(1,float('nan')))
                invalid(lambda d:d['table']['rows'][0].__setitem__(1,10**400))
                invalid(lambda d:d['table']['rows'][0].append('bad-width'))
                invalid(lambda d:d['table'].update(sourceRows=[]))
                invalid(lambda d:d['table'].update(sourceCells=None))
                invalid(lambda d:d['table'].update(currencyEvidence={'absent':['USD']}))
                invalid(lambda d:d['plan']['cards'][0].update(measure='c99'))
                invalid(lambda d:d['plan']['cards'].append(deepcopy(d['plan']['cards'][0])))
                invalid(lambda d:d['messages'][0].update(at='2026-02-30T00:00:00.000Z'))
                assert client.post(dashboards,params=scope,headers=alice,content=b'{' ).status_code==422
                assert client.post(dashboards,params=scope,headers=alice,content=b' '*(proposal.MAX_BYTES+1)).status_code==413
                checks.append('strict schema, source shape, finite numbers, nulls, size limits')

                defs_url=base+'/definitions/'+'b'*64
                assert client.get(defs_url,params=scope,headers=alice).json() is None
                defs=client.put(defs_url,params=scope,headers=alice,json=definitions())
                assert defs.status_code==200,defs.text
                assert defs.json()['version']==1
                assert client.get(defs_url,params=scope,headers=bob).json() is None
                assert client.put(defs_url,params=scope,headers=alice,json=definitions()).status_code==409
                def defs_writer(n):
                    body=definitions();body['expected_version']=1;body['fields'][1]['definition']=f'Confirmed net sales {n}'
                    return client.put(defs_url,params=scope,headers=alice,json=body)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    responses=list(pool.map(defs_writer,[1,2]))
                assert sorted(r.status_code for r in responses)==[200,409]
                with store.connect() as con:
                    assert con.execute('SELECT count(*) FROM analysis_studio_definition_history').fetchone()[0]==2
                assert client.put(defs_url,params=scope,headers=alice,json={**definitions(),'fingerprint':'c'*64}).status_code==422
                checks.append('per-owner reusable definitions, version CAS and history')

                store.put_user('alice','a','changed-hash','changed-salt')
                assert client.get(url,params=scope,headers=alice).status_code==401
                alice=user_auth('alice')
                assert client.get(url,params=scope,headers=alice).status_code==200
                store.set_user_disabled('alice',True)
                assert client.get(url,params=scope,headers=alice).status_code==401
                store.set_user_disabled('alice',False);alice=user_auth('alice')
                store.delete_user('alice');store.put_user('alice','a','new-hash','new-salt');alice=user_auth('alice')
                assert client.get(url,params=scope,headers=alice).status_code==404
                assert client.get(defs_url,params=scope,headers=alice).json() is None
                checks.append('password reset persistence, disabled sessions and account reincarnation isolation')

                own=client.post(dashboards,params=scope,headers=alice,json=document()).json(); own_url=dashboards+'/'+own['id']
                saved_context=store.put_context('a',ContextIn(retain_files=False,aliases={'confidential-client-label':'Internal registry label'}))
                safe_context=client.get(context_url,params=scope,headers=alice)
                assert safe_context.json()=={'ignore_sheets':[],'retain_files':False,'version':saved_context.version}
                assert 'confidential-client-label' not in safe_context.text and 'aliases' not in safe_context.text
                assert client.post(dashboards,params=scope,headers=alice,json=document()).status_code==409
                assert client.put(defs_url,params=scope,headers=alice,json=definitions()).status_code==409
                assert client.get(own_url,params=scope,headers=alice).status_code==200
                saved_context=store.put_context('a',ContextIn(ignore_sheets=[' CSV DATA ']))
                safe_context=client.get(context_url,params=scope,headers=alice).json()
                assert safe_context=={'ignore_sheets':[' CSV DATA '],'retain_files':True,'version':saved_context.version}
                assert client.post(dashboards,params=scope,headers=alice,json=document()).status_code==409
                assert client.delete(own_url,params={**scope,'expected_version':2},headers=alice).status_code==409
                assert client.delete(own_url,params={**scope,'expected_version':1},headers=alice).status_code==204
                store.put_context('a',ContextIn())
                checks.append('scoped minimal preparation context, retention, excluded sheets and versioned deletion')

                conn_url=base+'/ai/connection'; status_url=base+'/ai/status'; ai_url=base+'/ai/plan'
                connection={'provider':'openai','model':'gpt-5-mini','apiKey':'test-secret-key-that-must-never-appear'}
                status=client.get(status_url,params=scope,headers=alice).json()
                assert status['configured'] is False and status['canConfigure'] is False
                assert client.put(conn_url,params=scope,headers=alice,json=connection).status_code==403
                assert client.delete(conn_url,params=scope,headers=alice).status_code==403
                result=client.put(conn_url,params=scope,headers=admin,json=connection)
                assert result.status_code==503 and connection['apiKey'] not in result.text
                result=client.put(conn_url,params=scope,headers=admin,json={**connection,'apiKey':'secret'})
                assert result.status_code==422 and 'secret' not in result.text
                with store.connect() as con:
                    assert con.execute('SELECT count(*) FROM analysis_studio_ai_connections').fetchone()[0]==0
                fallback=client.post(ai_url,params=scope,headers=alice,json=ai_request()).json()
                assert fallback['planner']=='rules' and fallback['proposal'] is None
                os.environ['OPENAI_API_KEY']='test-server-key'
                status=client.get(status_url,params=scope,headers=alice).json()
                assert status['configured'] and status['source']=='environment' and 'test-server-key' not in json.dumps(status)
                proposal.provider_proposal=lambda *_:proposal.AIProposal.model_validate(valid_proposal())
                result=client.post(ai_url,params=scope,headers=alice,json=ai_request())
                assert result.status_code==200 and result.json()['planner']=='model',result.text
                assert result.json()['proposal']['action']=='add'
                bad=valid_proposal();bad['cards'][0]['measure']='c99'
                proposal.provider_proposal=lambda *_:proposal.AIProposal.model_validate(bad)
                result=client.post(ai_url,params=scope,headers=alice,json=ai_request())
                assert result.json()['planner']=='rules'
                bad=valid_proposal();bad['fields']=[{'id':'c1','role':'cost','unit':'USD','aggregation':'sum','definition':'Cost'}]
                result=client.post(ai_url,params=scope,headers=alice,json=ai_request())
                assert result.json()['planner']=='rules'
                def provider_error(*_):
                    raise RuntimeError('test-server-key')
                proposal.provider_proposal=provider_error
                result=client.post(ai_url,params=scope,headers=alice,json=ai_request())
                assert result.json()['planner']=='rules' and 'test-server-key' not in result.text
                checks.append('admin-only connections, no plaintext fallback, provider fallback, field allowlist and immutable confirmed mappings')

                if importlib.util.find_spec('cryptography'):
                    os.environ['LUMNIA_CREDENTIAL_KEY']=base64.urlsafe_b64encode(b'\x17'*32).decode()
                    result=client.put(conn_url,params=scope,headers=admin,json=connection)
                    assert result.status_code==200,result.text
                    assert result.json()['source']=='organization' and connection['apiKey'] not in result.text
                    with store.connect() as con:
                        encrypted=con.execute('SELECT encrypted_key FROM analysis_studio_ai_connections WHERE org=?',('a',)).fetchone()[0]
                    assert connection['apiKey'] not in encrypted
                    resolved=proposal.resolved_connection('a')
                    assert resolved[2]==connection['apiKey']
                    assert proposal.resolved_connection('b')[2]=='test-server-key'
                    with store.connect() as con:
                        con.execute("UPDATE analysis_studio_ai_connections SET model='other-model' WHERE org='a'")
                    try:
                        proposal.resolved_connection('a')
                        raise AssertionError('Tampered metadata must fail decryption')
                    except proposal.HTTPException as error:
                        assert error.status_code==503
                    assert client.delete(conn_url,params=scope,headers=admin).json()['source']=='environment'
                    checks.append('AES-GCM encrypted storage, authenticated organization/model binding, removal and environment fallback')
                else:
                    checks.append('encryption-unavailable failure path; AES-GCM round-trip requires optional cryptography dependency')

                assert store.delete_org('a')
                with store.connect() as con:
                    for table in ['analysis_studio_dashboards','analysis_studio_definitions','analysis_studio_definition_history','analysis_studio_ai_connections']:
                        assert con.execute(f'SELECT count(*) FROM {table} WHERE org=?',('a',)).fetchone()[0]==0
                checks.append('organization deletion cascades all new retained artifacts')
    finally:
        store.DB_PATH=old_db;proposal.provider_proposal=old_provider;proposal._AI_HITS.clear()
        for key,value in saved_env.items():
            if value is None:
                os.environ.pop(key,None)
            else:
                os.environ[key]=value
    print('PASS: '+'; '.join(checks)+'.')

def test_provider_http_adapter():
    """Exercise actual provider request/response parsing with mocked HTTP.

    No API key is loaded, and no network call is made. Provider errors and
    invalid proposals must never become successful analysis-plan responses.
    """
    import contextlib
    import io
    import httpx
    captured=[]
    scenario={'status':200,'response':None,'raw':None}
    original_client=httpx.Client
    request=proposal.AIRequest.model_validate(ai_request())
    provider_key='unit-test-provider-secret-never-log'
    connections={'openai':('openai','gpt-5-mini',provider_key),'anthropic':('anthropic','claude-sonnet-4-5',provider_key)}
    def payload(provider,document,**extra):
        if provider=='openai':
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(document)}]}],**extra}
        return {'stop_reason':'end_turn','content':[{'type':'text','text':json.dumps(document)}],**extra}
    class MockResponse:
        def __init__(self):
            self.status_code=scenario['status']
        def __enter__(self):return self
        def __exit__(self,*_):return False
        def iter_bytes(self):
            raw=scenario['raw'] if scenario['raw'] is not None else json.dumps(scenario['response']).encode()
            for offset in range(0,len(raw),4096):yield raw[offset:offset+4096]
    class MockClient:
        def __init__(self,**kwargs):
            assert kwargs['follow_redirects'] is False and kwargs['timeout']==30.0
        def __enter__(self):return self
        def __exit__(self,*_):return False
        def stream(self,method,url,headers,json):
            assert method=='POST'
            assert url in ['https://api.openai.com/v1/responses','https://api.anthropic.com/v1/messages']
            captured.append({'url':url,'headers':headers,'body':json})
            return MockResponse()
    def call(provider='openai'):
        result=proposal.provider_proposal(connections[provider],request)
        return None if result is None else proposal.validate_proposal(result,request)
    def rejected(provider='openai'):
        try:result=call(provider)
        except (ValueError,proposal.ValidationError):return
        assert result is None,'Invalid provider proposal must be rejected'
    try:
        httpx.Client=MockClient
        stdout,stderr=io.StringIO(),io.StringIO()
        with contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):
            for provider in ['openai','anthropic']:
                scenario['response']=payload(provider,valid_proposal())
                assert call(provider).action=='add'
                encoded=json.dumps(captured[-1]['body'])
                assert provider_key not in encoded
                assert 'sourceHash' not in encoded and 'sourceRows' not in encoded
                assert 'sales.csv' not in encoded
                if provider=='openai':
                    assert captured[-1]['headers']['Authorization']=='Bearer '+provider_key
                    assert captured[-1]['body']['store'] is False
                else:
                    assert captured[-1]['headers']['x-api-key']==provider_key
                with_optional_nulls=valid_proposal()
                with_optional_nulls['cards'][0].update(secondMeasure=None,period=None,horizon=None)
                scenario['response']=payload(provider,with_optional_nulls)
                assert call(provider).cards[0].tool=='breakdown'
                invalid=valid_proposal();invalid['explanation']=None
                scenario['response']=payload(provider,invalid);rejected(provider)
                invalid=valid_proposal();invalid['cards'][0]['measure']='c999'
                scenario['response']=payload(provider,invalid);rejected(provider)
                invalid=valid_proposal();invalid['fields']=[{'id':'c1','role':'cost','unit':'USD','aggregation':'sum','definition':'Cost'}]
                scenario['response']=payload(provider,invalid);rejected(provider)
                invalid=valid_proposal();invalid['cards'][0]['filters']=[{'field':'c999','op':'eq','value':'East'}]
                scenario['response']=payload(provider,invalid);rejected(provider)
                scenario['status']=401;scenario['response']={'error':{'message':provider_key}}
                assert call(provider) is None
                scenario['status']=200
            scenario['response']=payload('openai',valid_proposal(),status='incomplete');rejected()
            scenario['response']={'status':'completed','output':[{'type':'message','content':[{'type':'refusal','refusal':'Cannot do that'}]}]};rejected()
            for stop in ['refusal','max_tokens']:
                scenario['response']=payload('anthropic',valid_proposal(),stop_reason=stop)
                assert call('anthropic') is None
            scenario['raw']=b'{malformed provider response';rejected()
            scenario['raw']=b' '*(512*1024+1);assert call() is None
            scenario['raw']=None
        assert provider_key not in stdout.getvalue()+stderr.getvalue()
        assert not stdout.getvalue() and not stderr.getvalue()
    finally:
        httpx.Client=original_client
    print('PASS: mocked OpenAI/Anthropic HTTP parsing, metadata-only payload, completion/refusal checks, malformed/oversize responses, field/filter allowlists, immutable confirmed mappings and no credential/error logging.')

if __name__=='__main__':
    test_router()
    test_provider_http_adapter()
