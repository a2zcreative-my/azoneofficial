"""Shared browser probe setup. Missing navigation is a failure, never a skip."""
import json
import os
import time


def prepare(driver, base, width):
    driver.set_window_size(width, 950)
    driver.get(base + "/portal")
    driver.execute_script("localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang',arguments[0]);localStorage.setItem('azone-theme',arguments[1]);", os.environ.get("LANG_UI", "en"), os.environ.get("THEME", "light"))
    driver.get(base + "/portal")
    time.sleep(4)
    inner = driver.execute_script("return window.innerWidth")
    if inner != width:
        driver.set_window_size(width + width - inner, 950)
        time.sleep(1)
    if driver.execute_script("return window.innerWidth") != width:
        raise RuntimeError("Requested content viewport was not achieved")
    if not driver.execute_script("return !!document.querySelector('main') && !!document.getElementById('shell-scroll')"):
        raise RuntimeError("Portal shell did not render")


def click_tab(driver, name):
    found = driver.execute_script("""
      const visible = b => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0;
      const b = [...document.querySelectorAll('nav button')].find(b => visible(b) && b.textContent.trim() === arguments[0]);
      if (b) { b.click(); return true; }
      const more = [...document.querySelectorAll('button')].find(b => visible(b) && /^(More|Lagi)$/.test(b.textContent.trim()));
      if (more) more.click();
      return false;
    """, name)
    if found:
        return "clicked"
    time.sleep(0.8)
    found = driver.execute_script("""
      const dialog = document.querySelector('[role=dialog]');
      const b = dialog && [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === arguments[0]);
      if (!b) return false;
      b.click(); return true;
    """, name)
    if not found:
        raise RuntimeError("Requested tab could not be opened: " + name)
    return "clicked"


def complete(findings):
    print("BROWSER_PROBE_COMPLETE " + json.dumps({"findings": int(findings)}))
