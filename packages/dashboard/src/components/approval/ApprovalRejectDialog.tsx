import { useState } from 'react'

import type { EnrichedRun } from '@/api/client'
import { Btn } from '@/components/signal'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export function ApprovalRejectDialog({
  run,
  disabled,
  onReject,
  variant = 'danger',
}: {
  run: EnrichedRun
  disabled: boolean
  onReject: (run: EnrichedRun, reason: string) => void
  variant?: 'danger' | 'default'
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <>
      {variant === 'danger' ? (
        <Btn danger disabled={disabled} onClick={() => setOpen(true)}>
          Reject
        </Btn>
      ) : (
        <Btn disabled={disabled} onClick={() => setOpen(true)}>
          Request changes
        </Btn>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{variant === 'danger' ? 'Reject attempt' : 'Request changes'}</DialogTitle>
            <DialogDescription>
              {variant === 'danger'
                ? 'Provide a reason for rejecting this attempt.'
                : 'Describe the changes you want the agent to make.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={variant === 'danger' ? 'Rejection reason...' : 'What should change before merge?'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={5}
          />
          <DialogFooter>
            <Btn onClick={() => {
              setOpen(false)
              setReason('')
            }}
            >
              Cancel
            </Btn>
            <Btn
              danger={variant === 'danger'}
              primary={variant !== 'danger'}
              disabled={!reason.trim() || disabled}
              onClick={() => {
                onReject(run, reason.trim())
                setOpen(false)
                setReason('')
              }}
            >
              {variant === 'danger' ? 'Reject' : 'Send back'}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
