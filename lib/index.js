// dsh-f1-skin — node half. The skin's client bundle lives behind the "./client"
// export; this host-side plugin exists so the loader entry has a fiber and the
// dsh.client row joins the browser module graph. It also mounts the cockpit
// photograph route (/plugin-assets/dsh-f1-skin/*) once the web host provides
// the webServer service, serving full-resolution images staged by the build.
import { mountRoutes } from "./routes.js";

let mounted = false;

/**
 * Register the plugin against the host context.
 * @param ctx - host context that may acquire the webServer service.
 */
export function apply(ctx) {
  ctx.inject(["webServer"], (hostCtx) => {
    hostCtx.effect(() => {
      if (mounted) return;
      mounted = true;
      const disposeRoutes = mountRoutes(hostCtx);
      return () => {
        mounted = false;
        disposeRoutes();
      };
    }, "dsh-f1-skin: cockpit asset route");
  });
}
