import { useNavigate } from "react-router-dom";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="text-6xl font-bold text-muted-foreground/20">404</div>
      <h1 className="text-xl font-semibold">页面未找到</h1>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        你访问的页面不存在，或已被移动到其他位置。
      </p>
      <Button variant="outline" onClick={() => navigate("/")}>
        <Home /> 返回首页
      </Button>
    </div>
  );
}
