import { FormUnavailable } from '@/features/forms';

/** Unknown or closed form links: a plain explanation for outside visitors, no internal links. */
export default function NotFound() {
  return <FormUnavailable />;
}
