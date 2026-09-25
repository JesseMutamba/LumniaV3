"""Named-client integration gate for the minimal financial owner change.

Exercises the real financial router and verified client principal with a temporary DB.
"""
import importlib.util
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
ROOT=Path(__file__).resolve().parents[1]
API=ROOT
sys.path.insert(0,str(API))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import store
from app.auth import new_session
from app.schema import ContextIn,Text
from app.routers import financial as proposal
fixture_spec=importlib.util.spec_from_file_location('financial_fixtures',API/'tests'/'test_financial_reviews.py')
fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
document=fixture.document


def test_named_financial_clients():
    old_db=store.DB_PATH;old_token=os.environ.get('LUMNIA_ADMIN_TOKEN');os.environ['LUMNIA_ADMIN_TOKEN']='test-financial-admin'
    try:
        with TemporaryDirectory(prefix='financial-client-') as tmp:
            store.DB_PATH=Path(tmp)/'client.sqlite';store.init()
            for org in ['a','b']:store.put_org(org,org,Text(fr=org))
            for username,org in [('alice','a'),('bob','a'),('carol','b')]:store.put_user(username,org,'test-hash','test-salt')
            def auth(name):
                return {'Authorization':'Bearer '+new_session(name)[0]}
            alice=auth('alice');bob=auth('bob');carol=auth('carol');admin={'Authorization':'Bearer test-financial-admin'}
            app=FastAPI();app.include_router(proposal.router,prefix='/v1')
            with TestClient(app) as client:
                base='/v1/financial-reviews';org={'org':'a'}
                assert client.get(base,params=org).status_code==401
                assert client.post(base,params=org,json=document(),headers={'Authorization':'Bearer report-share-key'}).status_code==401
                assert client.get(base,params=org,headers=carol).status_code==404
                saved=client.post(base,params=org,headers=alice,json=document())
                assert saved.status_code==201,saved.text
                data=saved.json();url=base+'/'+data['id']
                assert data['review']==document()['review'] and data['version']==1
                assert data['review']['plan'][0]['hectares']['value'] is None
                assert client.get(url,params=org,headers=alice).json()==data
                assert client.get(base,params=org,headers=alice).json()[0]['id']==data['id']
                for other in [bob,carol,admin]:
                    assert client.get(url,params=org,headers=other).status_code==404
                    assert client.put(url,params=org,headers=other,json={**document(),'expected_version':1}).status_code==404
                    assert client.delete(url,params={**org,'expected_version':1},headers=other).status_code==404
                assert client.get(url,params={'org':'b'},headers=alice).status_code==404
                author_review=client.post(base,params=org,headers=admin,json=document())
                assert author_review.status_code==201
                assert client.get(base+'/'+author_review.json()['id'],params=org,headers=alice).status_code==404
                assert client.post(base,params=org,headers=alice,json={**document(),'owner':'author:primary'}).status_code==422
                assert client.put(url,params=org,headers=alice,json=document()).status_code==422
                def writer(delta):
                    body=deepcopy(document());body.update(expected_version=1,tab='risk');body['drivers']['pricePct']=delta
                    return client.put(url,params=org,headers=alice,json=body)
                with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(writer,[10,20]))
                assert sorted(r.status_code for r in responses)==[200,409],[r.text for r in responses]
                winner=next(r.json() for r in responses if r.status_code==200)
                assert winner['version']==2 and winner['tab']=='risk'
                assert client.get(url,params=org,headers=alice).json()==winner
                assert client.delete(url,params={**org,'expected_version':1},headers=alice).status_code==409
                # Changing the password revokes old sessions, but retains case ownership.
                store.put_user('alice','a','reset-hash','reset-salt')
                assert client.get(url,params=org,headers=alice).status_code==401
                alice=auth('alice');assert client.get(url,params=org,headers=alice).json()==winner
                store.set_user_disabled('alice',True)
                assert client.get(url,params=org,headers=alice).status_code==401
                store.set_user_disabled('alice',False);alice=auth('alice')
                store.put_context('a',ContextIn(retain_files=False))
                assert client.post(base,params=org,headers=alice,json=document()).status_code==409
                assert client.put(url,params=org,headers=alice,json={**document(),'expected_version':2}).status_code==409
                assert client.get(url,params=org,headers=alice).status_code==200
                store.put_context('a',ContextIn(ignore_sheets=[' PLAN ']))
                assert client.post(base,params=org,headers=alice,json=document()).status_code==409
                assert client.put(url,params=org,headers=alice,json={**document(),'expected_version':2}).status_code==409
                # Deletion remains available even when further retention is disabled.
                assert client.delete(url,params={**org,'expected_version':2},headers=alice).status_code==204
                assert client.get(url,params=org,headers=alice).status_code==404
                store.put_context('a',ContextIn())
                saved=client.post(base,params=org,headers=alice,json=document()).json();url=base+'/'+saved['id']
                store.delete_user('alice');store.put_user('alice','a','new-hash','new-salt');alice=auth('alice')
                assert client.get(url,params=org,headers=alice).status_code==404
                assert client.get(base,params=org,headers=alice).json()==[]
                assert store.delete_org('a')
                with store.connect() as con:assert con.execute("SELECT COUNT(*) FROM financial_reviews WHERE org='a'").fetchone()[0]==0
        print('PASS: named-client financial snapshot save/reopen, author compatibility, account/org isolation, source/null persistence, concurrent version CAS, password reset and account recreation, retention/exclusions, versioned deletion and org cascade.')
    finally:
        store.DB_PATH=old_db
        if old_token is None:os.environ.pop('LUMNIA_ADMIN_TOKEN',None)
        else:os.environ['LUMNIA_ADMIN_TOKEN']=old_token

if __name__=='__main__':test_named_financial_clients()
