import { useState } from 'react'

import { Btn } from '@/components/signal'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export function RejectDialog({
  runId,
  isPending,
  onReject,
}: {
  runId: string
  isPending: boolean
  onReject: (runId: string, reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Btn danger disabled={isPending} onClick={() => setOpen(true)}>Reject</Btn>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject attempt</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this attempt.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Rejection reason..." value={reason} onChange={(event) => setReason(event.target.value)} rows={5} />
          <DialogFooter>
            <Btn onClick={() => { setOpen(false); setReason('') }}>Cancel</Btn>
            <Btn danger disabled={!reason.trim() || isPending} onClick={() => { onReject(runId, reason); setOpen(false); setReason('') }}>Reject</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
