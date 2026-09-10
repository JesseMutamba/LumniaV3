import React from 'react'
import {Tabs as T,Dialog as D} from 'radix-ui'
export const Tabs=({children,...props})=><T.Root data-slot="tabs" {...props}>{children}</T.Root>
export const TabsList=({variant,children,...props})=><T.List data-slot="tabs-list" {...props}>{children}</T.List>
export const TabsTrigger=({children,...props})=><T.Trigger data-slot="tabs-trigger" {...props}>{children}</T.Trigger>
export const TabsContent=({children,...props})=><T.Content data-slot="tabs-content" {...props}>{children}</T.Content>
export const Button=React.forwardRef(function Button({variant='default',children,type='button',...props},ref){return <button ref={ref} data-slot="button" data-variant={variant} type={type} {...props}>{children}</button>})
export const Input=React.forwardRef(function Input(props,ref){return <input ref={ref} data-slot="input" {...props}/>})
export const Dialog=D.Root
export const DialogContent=({children,...props})=><D.Portal><D.Overlay className="fr-modal-overlay"/><D.Content {...props}><D.Close className="fr-modal-close" aria-label="Close dialog">×</D.Close>{children}</D.Content></D.Portal>
export const DialogHeader=({children})=><div className="fr-modal-header">{children}</div>
export const DialogTitle=props=><D.Title data-slot="dialog-title" {...props}/>
export const DialogDescription=props=><D.Description data-slot="dialog-description" {...props}/>
