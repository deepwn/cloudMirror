import ProviderIcon from "./ProviderIcon";
import type { ProviderDefinition } from "../providers/_base";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Check } from "lucide-react";

interface SearchProviderPickerProps {
  providers: ProviderDefinition[];
  activeId: string;
  onChange: (providerId: string) => void;
}

export default function SearchProviderPicker({
  providers,
  activeId,
  onChange,
}: SearchProviderPickerProps) {
  if (providers.length === 0) return null;

  const active = providers.find((provider) => provider.id === activeId) || providers[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-foreground outline-none transition-all duration-200 hover:bg-muted/70 hover:text-foreground active:scale-95 data-popup-open:bg-muted/70">
        <ProviderIcon icon={active.meta.icon} size={15} />
        <ChevronDown
          size={14}
          className="text-muted-foreground transition-transform duration-200 data-popup-open:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">切换搜索源</div>
        <DropdownMenuSeparator />
        <div className="max-h-72 overflow-y-auto">
          {providers.map((provider) => {
            const isActive = provider.id === activeId;

            return (
              <DropdownMenuItem
                key={provider.id}
                onClick={() => onChange(provider.id)}
                className="gap-2.5"
              >
                <ProviderIcon icon={provider.meta.icon} size={15} monochrome={!isActive} />
                <span className="min-w-0 flex-1 truncate">{provider.displayName}</span>
                {isActive && (
                  <Check
                    size={14}
                    className="animate-in zoom-in-75 fade-in duration-150 text-primary"
                  />
                )}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
