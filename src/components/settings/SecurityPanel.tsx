// ============================================================================
// SecurityPanel — 管理员安全策略面板 (统计概览 + 安全设置)
// ============================================================================

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Check, Users, Activity, KeyRound, Settings2, Lock, Shield } from "lucide-react";
import { admin } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/* ---------- types ---------- */
interface AdminStatsData {
  totalUsers: number;
  todayRequests: number;
  totalCredentials: number;
  activeProviders: number;
}

export default function SecurityPanel() {
  const [stats, setStats] = useState<AdminStatsData | null>(null);
  const [securitySettings, setSecuritySettings] = useState<Record<string, string>>({});
  const [securityDirty, setSecurityDirty] = useState<Record<string, string>>({});
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [pwdRequireNumber, setPwdRequireNumber] = useState(false);
  const [pwdRequireSymbol, setPwdRequireSymbol] = useState(false);
  const [allowPushUpload, setAllowPushUpload] = useState(false);
  const loaded = useRef(false);

  const loadSecuritySettings = async () => {
    setSecurityLoading(true);
    try {
      const [statsRes, settingsRes] = await Promise.all([
        admin.stats().then((r) => r?.data || null),
        admin.settings(),
      ]);
      setStats(statsRes);
      const map: Record<string, string> = {};
      (settingsRes.data || []).forEach((s: { key: string; value: string }) => {
        map[s.key] = s.value;
      });
      setSecuritySettings(map);
      setSecurityDirty({});
      setPwdRequireNumber(map["pwd_require_number"] === "1");
      setPwdRequireSymbol(map["pwd_require_symbol"] === "1");
      setAllowPushUpload(map["allow_push_upload"] === "1");
    } catch {
      /* ignore */
    } finally {
      setSecurityLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      loadSecuritySettings();
    }
  }, []);

  const handleSecurityChange = (key: string, value: string) => {
    setSecurityDirty((prev) => {
      if (value === (securitySettings[key] ?? "")) {
        const n = { ...prev };
        delete n[key];
        return n;
      }
      return { ...prev, [key]: value };
    });
  };

  const handlePwdToggle = (key: string, checked: boolean, setter: (v: boolean) => void) => {
    setter(checked);
    const v = checked ? "1" : "0";
    if (v === (securitySettings[key] ?? "0")) {
      setSecurityDirty((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
    } else {
      setSecurityDirty((prev) => ({ ...prev, [key]: v }));
    }
  };

  const handlePushUploadToggle = (checked: boolean) => {
    setAllowPushUpload(checked);
    const v = checked ? "1" : "0";
    if (v === (securitySettings["allow_push_upload"] ?? "0")) {
      setSecurityDirty((prev) => {
        const n = { ...prev };
        delete n["allow_push_upload"];
        return n;
      });
    } else {
      setSecurityDirty((prev) => ({ ...prev, allow_push_upload: v }));
    }
  };

  const saveSecurity = async () => {
    const entries = Object.entries(securityDirty);
    if (!entries.length) return;
    setSecuritySaving(true);
    try {
      await admin.updateSettings(entries.map(([k, v]) => ({ key: k, value: v })));
      setSecuritySettings((prev) => ({ ...prev, ...securityDirty }));
      setSecurityDirty({});
      toast.success("已保存，30s 内生效");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSecuritySaving(false);
    }
  };

  const hasSecurityChanges = Object.keys(securityDirty).length > 0;

  /** 获取设置值（dirty 优先 → DB → 默认值） */
  const val = (key: string, fallback: string) =>
    securityDirty[key] !== undefined ? securityDirty[key] : securitySettings[key] || fallback;

  return (
    <div className="flex flex-col gap-6">
      {/* 系统概览 */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "总用户", value: stats.totalUsers, icon: Users },
            { label: "今日请求", value: stats.todayRequests.toLocaleString(), icon: Activity },
            { label: "凭据数量", value: stats.totalCredentials, icon: KeyRound },
            { label: "活跃 Provider", value: stats.activeProviders, icon: Settings2 },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex flex-col items-center gap-1 py-4">
                <Icon size={18} className="text-muted-foreground" />
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 安全策略 */}
      {securityLoading ? (
        <Card>
          <CardContent className="py-8 flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---- 全局请求限制 ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Activity size={18} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <CardTitle>全局请求限制</CardTitle>
                  <CardDescription>白名单 IP 不受限制，30s 内生效。</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="rate-limit" className="text-sm shrink-0">
                    每分钟最大请求数
                  </Label>
                  <Input
                    id="rate-limit"
                    type="text"
                    className="w-24"
                    value={val("rate_limit", "600")}
                    onChange={(e) => handleSecurityChange("rate_limit", e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="allow-push-upload"
                    checked={allowPushUpload}
                    onCheckedChange={(c) => handlePushUploadToggle(c === true)}
                  />
                  <Label htmlFor="allow-push-upload" className="text-sm cursor-pointer">
                    允许推送/上传（Push/Upload）
                  </Label>
                </div>
              </div>
              {(securityDirty["rate_limit"] !== undefined ||
                securityDirty["allow_push_upload"] !== undefined) && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                  已修改，等待保存
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- 密码强度要求 ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Lock size={18} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <CardTitle>密码强度要求</CardTitle>
                  <CardDescription>新密码必须满足以下条件，字符始终必选。</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="pwd-min-length" className="text-sm shrink-0">
                    最小长度
                  </Label>
                  <Input
                    id="pwd-min-length"
                    type="text"
                    className="w-20"
                    value={val("pwd_min_length", "8")}
                    onChange={(e) => handleSecurityChange("pwd_min_length", e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="pwd-req-letter" checked disabled onCheckedChange={() => {}} />
                  <Label htmlFor="pwd-req-letter" className="text-sm text-muted-foreground">
                    包含字母
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="pwd-req-number"
                    checked={pwdRequireNumber}
                    onCheckedChange={(c) =>
                      handlePwdToggle("pwd_require_number", c === true, setPwdRequireNumber)
                    }
                  />
                  <Label htmlFor="pwd-req-number" className="text-sm cursor-pointer">
                    包含数字
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="pwd-req-symbol"
                    checked={pwdRequireSymbol}
                    onCheckedChange={(c) =>
                      handlePwdToggle("pwd_require_symbol", c === true, setPwdRequireSymbol)
                    }
                  />
                  <Label htmlFor="pwd-req-symbol" className="text-sm cursor-pointer">
                    包含符号
                  </Label>
                </div>
              </div>
              {(securityDirty["pwd_min_length"] !== undefined ||
                securityDirty["pwd_require_number"] !== undefined ||
                securityDirty["pwd_require_symbol"] !== undefined) && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                  已修改，等待保存
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- 爆破尝试上限 ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Shield size={18} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <CardTitle>爆破尝试上限</CardTitle>
                  <CardDescription>
                    后台登录失败或子域 Hash 猜测失败达到此次数后，IP 自动加入黑名单永久封禁。
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Label htmlFor="brute-limit" className="text-sm shrink-0">
                  失败次数上限
                </Label>
                <Input
                  id="brute-limit"
                  type="text"
                  className="w-24"
                  value={val("brute_limit_attempts", "5")}
                  onChange={(e) => handleSecurityChange("brute_limit_attempts", e.target.value)}
                />
              </div>
              {securityDirty["brute_limit_attempts"] !== undefined && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                  已修改，等待保存
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- 日志存储限制 ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Settings2 size={18} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <CardTitle>日志存储限制</CardTitle>
                  <CardDescription>
                    统一限制审计与用量日志的保留，防止 D1 配额超限。
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="log-retention" className="text-sm shrink-0">
                    最大保留天数
                  </Label>
                  <Input
                    id="log-retention"
                    type="text"
                    className="w-24"
                    value={val("log_retention_days", "90")}
                    onChange={(e) => handleSecurityChange("log_retention_days", e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="audit-max-rows" className="text-sm shrink-0">
                    滚动保留行数
                  </Label>
                  <Input
                    id="audit-max-rows"
                    type="text"
                    className="w-28"
                    value={val("audit_max_rows", "100000")}
                    onChange={(e) => handleSecurityChange("audit_max_rows", e.target.value)}
                  />
                </div>
              </div>
              {(securityDirty["log_retention_days"] !== undefined ||
                securityDirty["audit_max_rows"] !== undefined) && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
                  已修改，等待保存
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              {hasSecurityChanges
                ? `${Object.keys(securityDirty).length} 项未保存的更改`
                : "所有设置已是最新"}
            </p>
            <Button disabled={securitySaving || !hasSecurityChanges} onClick={saveSecurity}>
              <Check size={14} className="mr-1.5" />
              {securitySaving ? "保存中..." : "保存设置"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
