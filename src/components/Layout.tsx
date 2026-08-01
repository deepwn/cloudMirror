import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { TooltipProvider } from "./ui/tooltip";
import { UserProvidersProvider } from "../hooks/use-user-providers";
import Header from "./Header";

export default function Layout() {
  const { pathname } = useLocation();
  const isSplitLayout = pathname.startsWith("/docs") || pathname.startsWith("/dashboard");

  return (
    <UserProvidersProvider>
    <TooltipProvider>
      <div className="h-svh flex flex-col">
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 2500,
            style: { fontSize: "13px", borderRadius: "8px" },
          }}
        />
        <Header />
        <div className={isSplitLayout ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"}>
          <main
            className={[
              "mx-auto max-w-6xl px-4 sm:px-6 lg:px-8",
              isSplitLayout ? "h-full py-0" : "min-h-full py-8",
            ].join(" ")}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
    </UserProvidersProvider>
  );
}
