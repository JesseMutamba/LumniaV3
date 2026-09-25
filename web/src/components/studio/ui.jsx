import React from 'react'
export {Button,Input,Tabs,TabsList,TabsTrigger,TabsContent,Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '../financial/ui.jsx'
export const Select=React.forwardRef(function Select({children,...props},ref){return <div data-slot="native-select-wrapper"><select data-slot="native-select" ref={ref} {...props}>{children}</select></div>})
