// The Brands workspace: /brands (the gallery) and /brands/:id/:area (the brand studio).
// It runs on the shared router (ui/src/shared/router.tsx). Legacy /brands?brand=ID links are
// rewritten to /brands/ID/overview. Leaving a brand with unsaved changes asks first.
import { Button } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../shared/api";
import { addNavigationGuard, navigate, useRoute } from "../shared/router";
import { AppShell } from "../shared/studio";
import { ErrorSummary, Message, SkeletonBlock } from "../shared/ui";
import type { BrandSummary, Meta } from "../make/types";
import { BrandList } from "./BrandsPage";
import { Studio } from "./Studio";

export function BrandsWorkspace() {
  const route = useRoute();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [brands, setBrands] = useState<BrandSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text?: string; error?: string; key: number }>({ key: 0 });
  const [notes, setNotes] = useState<string[] | undefined>();
  const [leaving, setLeaving] = useState<string | null>(null);
  const dirty = useRef(false);
  const force = useRef(false);
  const setDirty = useCallback((d: boolean) => void (dirty.current = d), []);

  const brandId = route.params.brandId;
  const area = route.params.area;

  // Legacy and short links: /brands?brand=ID and /brands/ID become /brands/ID/overview.
  useEffect(() => {
    const legacy = route.query.get("brand");
    if (legacy) navigate(`/brands/${encodeURIComponent(legacy)}/overview`, { replace: true });
    else if (brandId && !area) navigate(`/brands/${encodeURIComponent(brandId)}/overview`, { replace: true });
  }, [route.path, brandId, area]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving this brand with unsaved changes: ask in the page first.
  useEffect(
    () =>
      addNavigationGuard((to) => {
        if (force.current || !dirty.current || !brandId) return true;
        const m = /^\/brands\/([^/?]+)/.exec(to);
        if (m && decodeURIComponent(m[1]) === brandId) return true;
        setLeaving(to);
        return false;
      }),
    [brandId],
  );

  const refresh = useCallback(async () => {
    try {
      setBrands(await api<BrandSummary[]>("GET", "/api/brands"));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api<Meta>("GET", "/api/meta")
      .then(setMeta)
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  // The gallery always shows a fresh list.
  useEffect(() => {
    if (!brandId) {
      document.title = "Brands - Video maker";
      refresh();
    }
  }, [brandId, refresh]);

  const go = useCallback((to: string, skipGuard = false) => {
    force.current = skipGuard;
    if (skipGuard) dirty.current = false;
    navigate(to);
    force.current = false;
  }, []);

  const openBrand = useCallback(
    (id: string, n?: string[]) => {
      setNotes(n);
      setMessage((m) => ({ key: m.key + 1 }));
      go(`/brands/${encodeURIComponent(id)}/overview`);
    },
    [go],
  );

  async function removeBrand(b: { id: string; name: string }): Promise<string | void> {
    try {
      await api("DELETE", `/api/brands/${encodeURIComponent(b.id)}`, { confirm: b.id });
    } catch (e) {
      return (e as Error).message;
    }
    setMessage((m) => ({ text: `${b.name} has been deleted.`, key: m.key + 1 }));
    go("/brands", true);
  }

  const leaveBar = leaving ? (
    <div className="leave-bar" role="alertdialog" aria-labelledby="leave-q">
      <Message tone="warn">
        <p id="leave-q">
          <strong>Leave without saving?</strong>
        </p>
        <div className="buttons">
          <Button
            className="danger"
            color="red"
            autoFocus
            onClick={() => {
              const to = leaving;
              setLeaving(null);
              go(to, true);
            }}
          >
            Leave
          </Button>
          <Button variant="default" onClick={() => setLeaving(null)}>
            Stay
          </Button>
        </div>
      </Message>
    </div>
  ) : null;

  if (loadError) {
    return (
      <AppShell
        workspace="brands"
        monitor={
          <div className="bw-pad">
            <ErrorSummary items={[loadError]} />
          </div>
        }
      />
    );
  }
  if (!meta || (!brandId && !brands)) {
    return (
      <AppShell
        workspace="brands"
        monitor={
          <div className="bw-pad">
            <SkeletonBlock height={240} label="Loading brands" />
          </div>
        }
      />
    );
  }
  if (!brandId) {
    return <BrandList key={message.key} brands={brands ?? []} message={message.text} error={message.error} onOpen={openBrand} onRemove={removeBrand} />;
  }
  return (
    <Studio
      key={brandId}
      id={brandId}
      area={area ?? "overview"}
      notes={notes}
      meta={meta}
      setDirty={setDirty}
      leaveBar={leaveBar}
      onLoadError={(msg) => {
        setMessage((m) => ({ error: msg, key: m.key + 1 }));
        go("/brands", true);
      }}
      removeBrand={removeBrand}
    />
  );
}
