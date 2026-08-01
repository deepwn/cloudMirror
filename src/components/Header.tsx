import { Link, useNavigate } from "react-router-dom";
import { Settings, LogOut, BookOpen } from "lucide-react";
import { getStoredUser, clearToken, dispatchAuthEvent } from "../lib/api";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Avatar, AvatarFallback } from "./ui/avatar";
import AuthDialog from "./AuthDialog";
import ModeToggle from "./ModeToggle";

export default function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState(getStoredUser());
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    const check = () => setUser(getStoredUser());
    window.addEventListener("storage", check);
    window.addEventListener("authchange", check);
    return () => {
      window.removeEventListener("storage", check);
      window.removeEventListener("authchange", check);
    };
  }, []);

  const handleLogout = () => {
    clearToken();
    setUser(null);
    dispatchAuthEvent();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto max-w-6xl flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 font-semibold text-sm no-underline">
          <img src="/logo.svg" alt="cloudMirror" className="size-6 dark:invert" />
          <span className="hidden sm:inline-block">cloudMirror</span>
        </Link>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => navigate("/docs")}
            title="使用文档"
            aria-label="使用文档"
          >
            <BookOpen size={16} />
          </Button>
          <ModeToggle />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="用户菜单"
              >
                <Avatar size="sm">
                  <AvatarFallback>{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline">{user.username}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  <Settings size={16} />
                  设置
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut size={16} />
                  登出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => setLoginOpen(true)}>登录</Button>
          )}
        </div>
      </div>
      <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </header>
  );
}
