import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

/** `/clients`: the client list is Profit by client (the breadcrumb on a client page points there too). */
export default function Page(): never {
  redirect(routes.profit({ by: 'client' }));
}
