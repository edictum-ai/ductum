import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsoluteTime, timeAgo } from '@/lib/utils'

interface RelativeTimeProps {
  dateStr: string
  className?: string
}

export function RelativeTime({ dateStr, className }: RelativeTimeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{timeAgo(dateStr)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatAbsoluteTime(dateStr)}</TooltipContent>
    </Tooltip>
  )
}
