// ============================================================================
// BackupPanel — 配置备份与恢复
// ============================================================================

import { useState } from "react";
import toast from "react-hot-toast";
import { Download, Upload, Archive, Terminal } from "lucide-react";
import { admin } from "../../lib/api";
import { Button } from "@/components/ui/button";
import CodeBlock from "../CodeBlock";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function BackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await admin.backup.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cloudmirror-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("备份已下载");
    } catch (err) {
      toast.error((err as Error).message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const payload = JSON.parse(text);
      const res = await admin.backup.import(payload);
      toast.success(res.message || "恢复成功");
      setImportFile(null);
    } catch (err) {
      toast.error((err as Error).message || "导入失败，请检查文件格式");
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setImportFile(file || null);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 导出备份 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download size={16} className="text-primary" />
            导出配置备份
          </CardTitle>
          <CardDescription>
            将系统设置与用户列表导出为 JSON 文件。不包含密码与凭据密钥（加密数据无法离线解密）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 text-xs text-muted-foreground space-y-1">
              <p>导出内容包括：</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>系统设置（限速、注册模式、密码策略等）</li>
                <li>用户列表（用户名、角色、状态）</li>
              </ul>
              <p className="text-muted-foreground/60 mt-1">建议定期导出并保存到安全位置。</p>
            </div>
            <Button onClick={handleExport} disabled={exporting} className="shrink-0">
              <Download size={14} className="mr-1.5" />
              {exporting ? "导出中..." : "下载备份"}
            </Button>
          </div>

          {/* SQL 全量备份提示 */}
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 space-y-2">
            <p className="flex items-center gap-1.5 font-medium">
              <Terminal size={12} /> Wrangler CLI 全量数据库备份
            </p>
            <CodeBlock
              code="wrangler d1 export cloudmirror-db --remote --output cloudmirror-backup.sql"
              variant="inline"
              ariaLabel="复制数据库导出命令"
              inputClassName="text-xs"
            />
            <p>
              全量备份包含审计日志与加密凭据。还原后需保持{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-[11px]">
                ENCRYPTION_KEY
              </code>{" "}
              与导出时一致，否则已加密凭据无法解密恢复。
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* 导入恢复 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload size={16} className="text-primary" />
            导入配置恢复
          </CardTitle>
          <CardDescription>
            从之前导出的 JSON 备份文件恢复设置与用户。不会覆盖现有用户和凭据。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="flex-1">
                <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-5 cursor-pointer hover:bg-muted/50 transition-colors">
                  <Archive size={20} className="text-muted-foreground shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">{importFile ? importFile.name : "选择备份文件"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : "支持 .json 格式"}
                    </p>
                  </div>
                </div>
                <input type="file" accept=".json" onChange={handleFileChange} className="hidden" />
              </label>
              <Button
                onClick={handleImport}
                disabled={!importFile || importing}
                className="shrink-0"
              >
                <Upload size={14} className="mr-1.5" />
                {importing ? "恢复中..." : "开始恢复"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              导入仅恢复用户记录与系统设置。密码、凭据密钥等加密数据不会写入，用户需重新设置密码。
            </p>
          </div>

          {/* SQL 全量还原提示 */}
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 space-y-2">
            <p className="flex items-center gap-1.5 font-medium">
              <Terminal size={12} /> Wrangler CLI 全量数据库还原
            </p>
            <CodeBlock
              code="wrangler d1 execute cloudmirror-db --file=cloudmirror-backup.sql --remote"
              variant="inline"
              ariaLabel="复制数据库还原命令"
              inputClassName="text-xs"
            />
            <p>
              全量还原适用于灾难恢复场景。执行前请先用{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-[11px]">yarn db:reset:remote</code>
              {" "}清空现有数据，再执行还原命令。确保{" "}
              <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-[11px]">ENCRYPTION_KEY</code>
              {" "}与导出时一致。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
