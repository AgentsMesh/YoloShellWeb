import { assert, type Cdp } from "./cdp";

export async function settings(page: Cdp): Promise<void> {
  await page.click("#settings-open");
  await page.waitFor("location.pathname === '/settings' && document.querySelector('#settings-machines li')");
  const quiet = await page.evaluate("document.getElementById('quiet').checked");
  await page.click("#quiet");
  await page.call("Page.reload");
  await page.waitFor(`document.querySelector('#settings-machines li') && document.getElementById('quiet').checked === ${!quiet}`);
  assert(await page.evaluate("!document.querySelector('#terminal-host')"), "Settings mounted a terminal");
  await page.click("#quiet");
  await page.click('.settings-header a[href="/"]');
  await page.waitFor("location.pathname === '/' && !document.getElementById('app')?.hidden");
}
