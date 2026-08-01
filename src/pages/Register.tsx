// ============================================================================
// Register.tsx — 邀请注册页面
// ============================================================================
// 路由: /register?invite=<code>
// ============================================================================

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { setToken, auth, dispatchAuthEvent } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function Register() {
  const [params] = useSearchParams();
  const inviteCode = params.get("invite") || "";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("密码至少 8 个字符");
      return;
    }
    if (!inviteCode) {
      toast.error("缺少邀请码");
      return;
    }
    setLoading(true);
    try {
      const data = await auth.registerWithInvite(
        username,
        password,
        inviteCode,
        email || undefined,
      );
      setToken(data.token);
      localStorage.setItem("cloudmirror_user", JSON.stringify(data.user));
      dispatchAuthEvent();
      toast.success(`欢迎，${data.user.username}`);
      navigate("/dashboard");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!inviteCode) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-sm">
          <CardContent className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              无效的注册链接，请联系管理员获取有效的邀请链接。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/logo.svg" alt="cloudMirror" className="mx-auto size-10 mb-2 dark:invert" />
          <CardTitle>创建账号</CardTitle>
          <CardDescription>使用邀请码注册 cloudMirror</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="reg-username">用户名</Label>
              <Input
                id="reg-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                minLength={3}
                maxLength={32}
                placeholder="3-32 个字符"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-email">
                邮箱 <span className="text-muted-foreground">(选填)</span>
              </Label>
              <Input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-password">密码</Label>
              <Input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="至少 8 个字符"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "注册中..." : "注册"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
