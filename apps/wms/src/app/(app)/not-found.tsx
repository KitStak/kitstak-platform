import { SearchX } from "lucide-react";
import { NotFoundTitle } from "@/components/layout/go-back-button";
import { NotFoundBackLink, NotFoundBreadcrumbs } from "@/components/layout/not-found-back-link";
import { HomeLink, StatusScreen } from "@/components/layout/status-screen";

/** Missing record inside the app (thrown by `notFound()`; cross-scope records also land here). */
export default function AppNotFound() {
  return (
    <>
      <NotFoundTitle />
      <NotFoundBreadcrumbs />
      <StatusScreen
        code="404"
        icon={SearchX}
        title="We couldn't find that record"
        description="It may have been deleted, or it belongs to a warehouse or client outside your access."
        actions={
          <>
            <NotFoundBackLink />
            <HomeLink />
          </>
        }
      />
    </>
  );
}
