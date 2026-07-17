import * as undici from "undici";

let configuredProxy: string | undefined;

function getPiProxy(): string | undefined {
  const proxy = (process.env.PI_PROXY ?? process.env.pi_proxy)?.trim();
  return proxy || undefined;
}

export function configurePiWebHttpProxy(): void {
  const proxy = getPiProxy();
  if (!proxy) return;
  if (configuredProxy === proxy) return;

  // PI_PROXY/pi_proxy is the only pi-web-specific proxy switch. If it is not
  // set, pi-web leaves networking untouched and uses the normal direct path.
  process.env.HTTP_PROXY = proxy;
  process.env.HTTPS_PROXY = proxy;
  process.env.http_proxy = proxy;
  process.env.https_proxy = proxy;

  undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());

  // Do NOT call undici.install() in the Next.js server process. Replacing the
  // global Response class makes Next route handlers reject valid NextResponse
  // objects in dev mode.
  configuredProxy = proxy;
}
