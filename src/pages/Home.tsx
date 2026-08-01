// ============================================================================
// Home.tsx — 主页搜索
// ============================================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Search, ShieldCheck, Star, Heart } from "lucide-react";
import { siGithub } from "simple-icons";
import { auth, setToken, dispatchAuthEvent, request as api } from "../lib/api";
import { useSearchProviders } from "../hooks/use-provider";
import SearchProviderPicker from "../components/SearchProviderPicker";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserProvider } from "../shared/types";

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState("github");
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [setupUser, setSetupUser] = useState("");
  const [setupPass, setSetupPass] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const navigate = useNavigate();
  const allProviders = useSearchProviders();

  // 加载用户启用的 Provider 列表
  const [enabledSet, setEnabledSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    api<{ success: boolean; data: UserProvider[] }>("/providers")
      .then((r) => {
        const set = new Set<string>();
        for (const up of r.data) {
          if (up.enabled) set.add(up.provider);
        }
        setEnabledSet(set);
      })
      .catch(() => setEnabledSet(null));
  }, []);

  // 过滤可用 Providers（未登录时显示全部）
  const searchProviders =
    enabledSet === null ? allProviders : allProviders.filter((p) => enabledSet.has(p.id));

  // 如果当前 activeType 不在可用列表，切换到第一个
  useEffect(() => {
    if (searchProviders.length > 0 && !searchProviders.some((p) => p.id === activeType)) {
      setActiveType(searchProviders[0].id);
    }
  }, [searchProviders, activeType]);

  useEffect(() => {
    auth
      .setupStatus()
      .then((r) => setSetupNeeded(r.needsSetup))
      .catch(() => setSetupNeeded(false));
  }, []);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupUser || !setupPass) {
      toast.error("请填写用户名和密码");
      return;
    }
    if (setupPass.length < 8) {
      toast.error("密码至少 8 位");
      return;
    }
    setSetupLoading(true);
    try {
      const data = await auth.setup({ username: setupUser, password: setupPass });
      setToken(data.token);
      localStorage.setItem("cloudmirror_user", JSON.stringify(data.user));
      dispatchAuthEvent();
      toast.success("管理员已创建，欢迎！");
      setSetupNeeded(false);
      navigate("/dashboard");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSetupLoading(false);
    }
  };

  const active = searchProviders.find((p) => p.id === activeType);
  const searchLabel = active?.meta.searchLabel || "搜索...";

  const handleSearch = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e && "preventDefault" in e) e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}&type=${activeType}`);
  };

  /* ──── 初始化管理员 ──── */
  if (setupNeeded === true) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[75vh] gap-10 px-4">
        <div className="text-center select-none">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-linear-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
            cloudMirror
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2.5">初始化管理员账户</p>
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={18} />
              创建管理员
            </CardTitle>
            <CardDescription>检测到系统中没有管理员账户，请先创建。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetup} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-user">用户名</Label>
                <Input
                  id="setup-user"
                  placeholder="admin"
                  value={setupUser}
                  onChange={(e) => setSetupUser(e.target.value)}
                  required
                  autoFocus
                  minLength={3}
                  maxLength={32}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-pass">密码</Label>
                <Input
                  id="setup-pass"
                  type="password"
                  placeholder="至少 8 位"
                  value={setupPass}
                  onChange={(e) => setSetupPass(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <Button type="submit" disabled={setupLoading} className="w-full">
                <ShieldCheck size={14} className="mr-1.5" />
                {setupLoading ? "创建中..." : "初始化管理员"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (setupNeeded === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[75vh] gap-10 px-4">
        <Skeleton className="h-20 w-72" />
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-10 w-full max-w-2xl rounded-lg" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[75vh] gap-10 px-4">
      {/* ──── Title ──── */}
      <div className="text-center select-none">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-linear-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
          cloudMirror
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-2.5">开发源集成管理平台</p>
      </div>

      {/* ──── Search ──── */}
      <div className="w-full max-w-3xl">
        {/* Search box — prefix source switcher + standalone submit button */}
        <Field>
          <FieldLabel htmlFor="home-search" className="sr-only">
            搜索
          </FieldLabel>
          <div className="flex items-center gap-3">
            <InputGroup className="h-11 flex-1 rounded-xl bg-background">
              <InputGroupAddon align="inline-start">
                <SearchProviderPicker
                  providers={searchProviders}
                  activeId={activeType}
                  onChange={setActiveType}
                />
              </InputGroupAddon>
              <InputGroupInput
                id="home-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder={searchLabel}
                autoFocus
                className="h-11 text-base"
              />
            </InputGroup>
            <Button
              type="button"
              onClick={() => handleSearch()}
              className="h-11 shrink-0 rounded-xl px-4 sm:px-5"
            >
              <Search size={16} />
              <span className="hidden sm:inline">搜索</span>
            </Button>
          </div>
        </Field>
      </div>

      {/* ──── GitHub 指引 ──── */}
      <a
        href="https://github.com/deepwn/cloudMirror"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors z-50"
      >
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          className="shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d={siGithub.path} fill="currentColor" />
        </svg>
        <span>Star it!</span>
        <Star size={12} className="shrink-0 fill-current text-yellow-500" />
        <span>And deploy it!</span>
        <Heart size={12} className="shrink-0 fill-current text-red-500" />
      </a>
    </div>
  );
}
