import React from 'react'
import {Tabs as T,Dialog as D} from 'radix-ui'
export const Tabs=({children,...props})=><T.Root data-slot="tabs" {...props}>{children}</T.Root>
export const TabsList=({variant='default',children,...props})=><T.List data-slot="tabs-list" data-variant={variant} {...props}>{children}</T.List>
export const TabsTrigger=({children,...props})=><T.Trigger data-slot="tabs-trigger" {...props}>{children}</T.Trigger>
export const TabsContent=({children,...props})=><T.Content data-slot="tabs-content" {...props}>{children}</T.Content>
export const Button=React.forwardRef(function Button({variant='default',size='default',children,type='button',...props},ref){return <button ref={ref} data-slot="button" data-variant={variant} data-size={size} type={type} {...props}>{children}</button>})
export const Input=React.forwardRef(function Input(props,ref){return <input ref={ref} data-slot="input" {...props}/>})
export const Dialog=D.Root
export const DialogContent=React.forwardRef(function DialogContent({children,className='',showCloseButton=true,...props},ref){return <D.Portal><D.Overlay data-slot="dialog-overlay" className="fr-modal-overlay"/><D.Content ref={ref} data-slot="dialog-content" className={'fr-modal-content '+className} {...props}>{children}{showCloseButton&&<D.Close type="button" className="fr-modal-close" aria-label="Close dialog">×</D.Close>}</D.Content></D.Portal>})
export const DialogHeader=({children,className='',...props})=><div data-slot="dialog-header" className={'fr-modal-header '+className} {...props}>{children}</div>
export const DialogTitle=props=><D.Title data-slot="dialog-title" {...props}/>
export const DialogDescription=props=><D.Description data-slot="dialog-description" {...props}/>
