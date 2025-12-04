import * as React from "react"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"
import { Button } from "./Button"
import { Card, CardContent, CardHeader, CardTitle } from "./Card"

const Dialog = ({ open, onOpenChange, children }) => {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 flex items-center justify-center p-4">
      <div className="fixed inset-0" onClick={() => onOpenChange(false)} />
        {children}
    </div>
  )
}

const DialogContent = React.forwardRef(({ className, title, children, onOpenChange, ...props }, ref) => (
  <Card
    ref={ref}
    className={cn(
      "z-50 grid w-full max-w-lg gap-4 bg-background p-0 shadow-lg duration-200 animate-in zoom-in-95 slide-in-from-bottom-10 sm:rounded-lg relative",
      className
    )}
    {...props}
  >
    <div className="flex items-center justify-between p-6 pb-0">
        <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>
        <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-6 w-6 rounded-md p-0.5">
            <X className="h-4 w-4" />
        </Button>
    </div>
    <div className="p-6 pt-4">
        {children}
    </div>
  </Card>
))
DialogContent.displayName = "DialogContent"

export { Dialog, DialogContent }


