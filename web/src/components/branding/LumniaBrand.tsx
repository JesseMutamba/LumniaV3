/** Supplied LUMNIA vector artwork: original paths, trimmed to the lockup. */
export function LumniaLogo({variant='void',className=''}:{variant?:'paper'|'void';className?:string}){
 return <img src={'/brand/lumnia-logo-'+variant+'.svg'} alt="LUMNIA" width={200} height={52} className={'lumnia-logo '+className}/>;
}
export function LumniaMark({variant='paper',className=''}:{variant?:'paper'|'void';className?:string}){
 return <img src={'/brand/lumnia-mark-'+variant+'.svg'} alt="" aria-hidden="true" width={32} height={32} className={'lumnia-mark '+className}/>;
}
