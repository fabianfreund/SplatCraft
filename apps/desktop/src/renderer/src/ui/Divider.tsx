import { cn } from './cn';

export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div className={cn(vertical ? 'h-4 w-px self-center' : 'h-px w-full', 'shrink-0 bg-line', className)} />;
}
