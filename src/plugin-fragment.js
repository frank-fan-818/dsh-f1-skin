// dsh-f1-skin client runtime. Global appearance uses the theme service;
    // all controls render inside DSH's native settings.section slot.
    const React = require("react");
    const h = React.createElement;
    const SOURCE = "dsh-f1-skin";
    const STORE = {
      team: "dsh-f1-skin:team",
      photo: "dsh-f1-skin:photo",
      surface: "dsh-f1-skin:surface",
      blur: "dsh-f1-skin:blur",
      motion: "dsh-f1-skin:motion",
      wallpapers: "dsh-f1-skin:wallpapers"
    };
    const DEFAULTS = { photo: 100, surface: 84, blur: 10, motion: true };
    let applySerial = 0;

    function findTeam(id) {
      for (const team of TEAMS) if (team.id === id) return team;
      return TEAMS[0];
    }

    function readStore(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    }

    function writeStore(key, value) {
      try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
    }

    // Per-team custom wallpapers: { [teamId]: "/plugin-assets/dsh-f1-skin-custom/….jpg" }.
    function readWallpaperMap() {
      try {
        const raw = localStorage.getItem(STORE.wallpapers);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch { return {}; }
    }

    function writeWallpaperMap(map) {
      try { localStorage.setItem(STORE.wallpapers, JSON.stringify(map)); } catch { /* private mode */ }
    }

    function readBoundedNumber(key, fallback, min, max) {
      const stored = readStore(key);
      if (stored === null || stored === "") return fallback;
      const parsed = Number(stored);
      return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
    }

    function readPreferences() {
      return {
        photo: readBoundedNumber(STORE.photo, DEFAULTS.photo, 65, 100),
        surface: readBoundedNumber(STORE.surface, DEFAULTS.surface, 76, 96),
        blur: readBoundedNumber(STORE.blur, DEFAULTS.blur, 0, 20),
        motion: readStore(STORE.motion) !== "off"
      };
    }

    function applyPreferences(prefs) {
      const root = document.documentElement;
      root.style.setProperty("--f1-photo-strength", `${prefs.photo}%`);
      root.style.setProperty("--f1-surface-strength", `${prefs.surface}%`);
      root.style.setProperty("--f1-blur", `${prefs.blur}px`);
      root.setAttribute("data-f1-motion", prefs.motion ? "on" : "off");
    }

    function syncDarkMode(ctx) {
      const applyAttr = () => {
        const dark = document.body.hasAttribute("data-ds-dark-theme");
        document.documentElement.setAttribute("data-f1-dark", dark ? "true" : "false");
      };
      applyAttr();
      ctx.effect(() => {
        const observer = new MutationObserver(applyAttr);
        observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
        return () => observer.disconnect();
      }, "dsh-f1-skin: dark-mode sync");
    }

    function applyTeam(runtime, theme, team) {
      if (runtime.lastTeamId !== team.id || runtime.tokenDisposer === null) {
        const nextDisposer = theme.overrideTokens(runtime.source, makeTeamTokens(team));
        runtime.tokenDisposer = nextDisposer;
        runtime.lastTeamId = team.id;
      }
      const root = document.documentElement;
      root.style.setProperty("--f1-accent-dark", team.dark.brand);
      root.style.setProperty("--f1-accent-light", team.light.brand);
      root.style.setProperty("--f1-accent-text-dark", team.dark.brandText);
      root.style.setProperty("--f1-accent-text-light", team.light.brandText);
      root.style.setProperty("--f1-secondary", team.dark.biz);
      root.style.setProperty("--f1-on-accent-dark", team.onBrandDark);
      root.style.setProperty("--f1-on-accent-light", team.onBrandLight);
      root.style.setProperty("--f1-tint", team.tint);
      const customUrl = runtime.wallpapers[team.id];
      root.style.setProperty("--f1-cockpit", `url("${customUrl || team.cockpit}")`);
      root.style.setProperty("--f1-team-logo", `url("${team.logo}")`);
      root.style.setProperty("--f1-cockpit-position", team.position || "center");
      root.style.setProperty("--f1-cockpit-mobile-position", team.mobilePosition || team.position || "center");
      root.style.setProperty("--f1-panel-dark", team.dark.layer1);
      root.style.setProperty("--f1-panel-2-dark", team.dark.layer2);
      root.style.setProperty("--f1-panel-light", team.light.layer1);
      root.style.setProperty("--f1-panel-2-light", team.light.platform);
      root.style.setProperty("--f1-success-dark", team.dark.success);
      root.style.setProperty("--f1-success-light", team.light.success);
      root.style.setProperty("--f1-warning-dark", team.dark.warn);
      root.style.setProperty("--f1-warning-light", team.light.warn);
      root.style.setProperty("--f1-danger-dark", team.dark.error);
      root.style.setProperty("--f1-danger-light", team.light.error);
      root.setAttribute("data-f1-team", team.id);
      root.setAttribute("data-f1-personality", team.personality);
      root.setAttribute("data-f1-instance", runtime.id);
      writeStore(STORE.team, team.id);
      runtime.emit();
    }

    function installCss(ctx, runtime) {
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-f1-skin";
        tag.dataset.pluginCss = "dsh-f1-skin/native-settings.css";
        tag.dataset.f1Instance = runtime.id;
        tag.textContent = F1_CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, "dsh-f1-skin: stylesheet");
    }

    function createSettingsSection(runtime) {
      return function F1SettingsSection() {
        const [snapshot, setSnapshot] = React.useState(() => runtime.snapshot());
        React.useEffect(() => runtime.subscribe(setSnapshot), []);
        const [wallpaperState, setWallpaperState] = React.useState({ busy: false, msg: "" });
        const [library, setLibrary] = React.useState({ loading: false, items: [] });

        const reloadLibrary = () => {
          fetch("/plugin-assets/dsh-f1-skin-custom/list")
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((payload) => setLibrary({
              loading: false,
              items: payload && Array.isArray(payload.wallpapers) ? payload.wallpapers : []
            }))
            .catch(() => setLibrary({ loading: false, items: [] }));
        };
        React.useEffect(() => { reloadLibrary(); }, []);

        const teamCards = TEAMS.map((team) => h("button", {
          type: "button",
          key: team.id,
          className: "dsh-f1-team-card",
          "aria-pressed": snapshot.teamId === team.id,
          onClick: () => runtime.selectTeam(team.id),
          style: {
            "--team-color-dark": team.dark.brandText,
            "--team-color-light": team.light.brandText,
            "--team-position": team.position || "center"
          }
        },
        h("span", {
          className: "dsh-f1-team-card__image",
          "aria-hidden": "true",
          style: { backgroundImage: `url("${(snapshot.wallpapers || {})[team.id] || team.cockpit}")` }
        }),
        h("span", { className: "dsh-f1-team-card__body" },
          h("strong", { className: "dsh-f1-team-card__name" }, team.name),
          h("span", {
            className: "dsh-f1-team-card__mark",
            "aria-hidden": "true",
            style: { backgroundImage: `url("${team.logo}")` }
          })
        )));

        const range = (key, label, min, max, suffix) => h("label", {
          className: "dsh-f1-setting",
          key
        },
        h("span", { className: "dsh-f1-setting__label" }, label),
        h("input", {
          type: "range",
          min,
          max,
          step: 1,
          value: snapshot[key],
          onChange: (event) => runtime.setPreference(key, Number(event.target.value))
        }),
        h("output", null, `${snapshot[key]}${suffix}`));

        const current = findTeam(snapshot.teamId);

        const onPickWallpaper = (event) => {
          const input = event.target;
          const file = input.files && input.files[0];
          input.value = "";
          if (!file) return;
          setWallpaperState({ busy: true, msg: "上传中…" });
          runtime.uploadWallpaper(file)
            .then(() => { reloadLibrary(); setWallpaperState({ busy: false, msg: "" }); })
            .catch(() => setWallpaperState({ busy: false, msg: "上传失败，请重试" }));
        };
        const applyLibraryWallpaper = (url) => {
          runtime.applyWallpaperUrl(url);
          setWallpaperState({ busy: false, msg: "" });
        };
        const removeLibraryWallpaper = (url) => {
          setWallpaperState({ busy: true, msg: "删除中…" });
          runtime.deleteWallpaper(url)
            .then(() => { reloadLibrary(); setWallpaperState({ busy: false, msg: "" }); })
            .catch(() => setWallpaperState({ busy: false, msg: "删除失败，请重试" }));
        };
        return h("section", { className: "dsh-f1-settings", "aria-label": "Formula One 车队皮肤" },
          h("header", { className: "dsh-f1-settings__header" },
            h("div", null,
              h("div", { className: "dsh-f1-settings__eyebrow" }, "RACE CONTROL / TEAM GARAGE"),
              h("h2", { className: "dsh-f1-settings__title" }, "Formula One 车队皮肤"),
              h("p", { className: "dsh-f1-settings__description" },
                "选择车队并调节背景表现。设置页沿用 DSH 原生布局，皮肤不会改变宿主控件尺寸。")),
            h("div", { className: "dsh-f1-settings__status" }, current.name)
          ),
          h("div", { className: "dsh-f1-settings__grid" }, teamCards),
          h("section", { className: "dsh-f1-settings__panel", "aria-label": "视觉强度" },
            h("h3", { className: "dsh-f1-settings__panel-title" }, "视觉强度"),
            h("p", { className: "dsh-f1-settings__panel-hint" },
              "背景与文字表面分开调节；原生设置页、菜单和弹窗始终保持完整宽度。"),
            range("photo", "背景图片", 65, 100, "%"),
            range("surface", "文字衬底", 76, 96, "%"),
            range("blur", "背景模糊", 0, 20, "PX"),
            h("label", { className: "dsh-f1-setting" },
              h("span", { className: "dsh-f1-setting__label" }, "动态效果"),
              h("input", {
                type: "checkbox",
                checked: snapshot.motion,
                onChange: (event) => runtime.setPreference("motion", event.target.checked)
              }),
              h("output", null, snapshot.motion ? "ON" : "OFF"))
          ),
          h("section", { className: "dsh-f1-settings__panel", "aria-label": "自定义背景" },
            h("h3", { className: "dsh-f1-settings__panel-title" }, "自定义背景"),
            h("p", { className: "dsh-f1-settings__panel-hint" },
              `为当前车队「${current.name}」单独选择背景图（任意分辨率，JPEG/PNG/WebP，≤25MB）。相同图片只存一份，可复用于多个车队。`),
            h("label", { className: "dsh-f1-setting" },
              h("span", { className: "dsh-f1-setting__label" }, "背景图片"),
              h("input", {
                type: "file",
                accept: "image/jpeg,image/png,image/webp",
                disabled: wallpaperState.busy,
                onChange: onPickWallpaper
              }),
              h("output", null, snapshot.customUrl ? "自定义" : "车队默认")),
            library.items.length > 0
              ? h("div", { className: "dsh-f1-settings__library" },
                  h("p", { className: "dsh-f1-settings__library-title" },
                    `已上传（${library.items.length}）：点“应用”给「${current.name}」；删除会同时清掉所有车队对它的引用`),
                  h("div", { className: "dsh-f1-settings__library-grid" },
                    library.items.map((item) =>
                      h("div", {
                        key: item.url,
                        className: "dsh-f1-settings__wallpaper-tile" + (snapshot.customUrl === item.url ? " is-active" : ""),
                        title: item.id
                      },
                        h("img", { src: item.url, alt: "", loading: "lazy" }),
                        h("div", { className: "dsh-f1-settings__tile-meta" },
                          `${Math.max(1, Math.round(item.size / 1024))} KB`),
                        h("div", { className: "dsh-f1-settings__tile-actions" },
                          h("button", { type: "button", disabled: wallpaperState.busy,
                            onClick: () => applyLibraryWallpaper(item.url) }, "应用"),
                          h("button", { type: "button", className: "is-danger", disabled: wallpaperState.busy,
                            onClick: () => removeLibraryWallpaper(item.url) }, "删除"))))))
              : h("p", { className: "dsh-f1-settings__library-empty" },
                  "尚未上传自定义壁纸。"),
            h("div", { className: "dsh-f1-settings__wallpaper-actions" },
              h("button", {
                type: "button",
                className: "dsh-f1-settings__reset",
                disabled: !snapshot.customUrl,
                onClick: () => {
                  runtime.clearWallpaper();
                  setWallpaperState({ busy: false, msg: "" });
                }
              }, "恢复该车队默认"),
              wallpaperState.msg
                ? h("span", { className: "dsh-f1-settings__msg" }, wallpaperState.msg)
                : null)
          )
        );
      };
    }

    const inject = ["theme", "slots"];

    function apply(ctx) {
      const theme = ctx.get("theme");
      const serial = ++applySerial;
      const instanceId = `${Date.now().toString(36)}-${serial.toString(36)}-${Math.random().toString(36).slice(2)}`;
      const listeners = new Set();
      const runtime = {
        id: instanceId,
        source: SOURCE,
        tokenDisposer: null,
        lastTeamId: null,
        prefs: readPreferences(),
        wallpapers: readWallpaperMap(),
        currentTeamId() {
          return this.lastTeamId || TEAMS[0].id;
        },
        snapshot() {
          const teamId = this.currentTeamId();
          return { teamId, ...this.prefs, wallpapers: this.wallpapers, customUrl: this.wallpapers[teamId] || "" };
        },
        emit() {
          const next = this.snapshot();
          for (const listener of listeners) listener(next);
        },
        subscribe(listener) {
          listeners.add(listener);
          listener(this.snapshot());
          return () => listeners.delete(listener);
        },
        selectTeam(id) {
          applyTeam(this, theme, findTeam(id));
        },
        applyWallpaperUrl(url) {
          if (typeof url !== "string" || url === "") return;
          const teamId = this.currentTeamId();
          if (this.wallpapers[teamId] === url) return;
          this.wallpapers = { ...this.wallpapers, [teamId]: url };
          writeWallpaperMap(this.wallpapers);
          applyTeam(this, theme, findTeam(teamId));
        },
        async uploadWallpaper(file) {
          if (!file) throw new Error("no file selected");
          const res = await fetch("/plugin-assets/dsh-f1-skin-custom/upload", { method: "POST", body: file });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const payload = await res.json().catch(() => null);
          const url = payload && typeof payload.url === "string" ? payload.url : null;
          if (!url) throw new Error("upload response missing url");
          this.applyWallpaperUrl(url);
          return url;
        },
        async deleteWallpaper(url) {
          const res = await fetch("/plugin-assets/dsh-f1-skin-custom/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url })
          });
          if (!res.ok) throw new Error(`delete failed (${res.status})`);
          let changed = false;
          const next = {};
          for (const key of Object.keys(this.wallpapers)) {
            if (this.wallpapers[key] === url) { changed = true; continue; }
            next[key] = this.wallpapers[key];
          }
          if (changed) {
            this.wallpapers = next;
            writeWallpaperMap(next);
            applyTeam(this, theme, findTeam(this.currentTeamId()));
          }
          return true;
        },
        clearWallpaper() {
          const teamId = this.currentTeamId();
          if (!Object.prototype.hasOwnProperty.call(this.wallpapers, teamId)) return;
          const next = { ...this.wallpapers };
          delete next[teamId];
          this.wallpapers = next;
          writeWallpaperMap(next);
          applyTeam(this, theme, findTeam(teamId));
        },
        setPreference(key, value) {
          if (!(key in this.prefs)) return;
          this.prefs = { ...this.prefs, [key]: value };
          writeStore(STORE[key], key === "motion" ? (value ? "on" : "off") : value);
          applyPreferences(this.prefs);
          this.emit();
        }
      };

      installCss(ctx, runtime);
      syncDarkMode(ctx);
      applyPreferences(runtime.prefs);
      applyTeam(runtime, theme, findTeam(readStore(STORE.team)));

      const SettingsSection = createSettingsSection(runtime);
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "dsh-f1-garage",
        order: 32,
        label: () => "Formula One 车队"
      }, SettingsSection));

      ctx.on("dispose", () => {
        listeners.clear();
        if (runtime.tokenDisposer) runtime.tokenDisposer();
        runtime.tokenDisposer = null;
        const root = document.documentElement;
        if (root.getAttribute("data-f1-instance") !== runtime.id) return;
        for (const name of [
          "--f1-accent-dark", "--f1-accent-light", "--f1-accent-text-dark", "--f1-accent-text-light",
          "--f1-secondary", "--f1-on-accent-dark", "--f1-on-accent-light", "--f1-tint",
          "--f1-cockpit", "--f1-team-logo", "--f1-cockpit-position", "--f1-cockpit-mobile-position", "--f1-panel-dark",
          "--f1-panel-2-dark", "--f1-panel-light", "--f1-panel-2-light", "--f1-success-dark",
          "--f1-success-light", "--f1-warning-dark", "--f1-warning-light", "--f1-danger-dark",
          "--f1-danger-light", "--f1-photo-strength", "--f1-surface-strength", "--f1-blur"
        ]) root.style.removeProperty(name);
        for (const name of [
          "data-f1-team", "data-f1-personality", "data-f1-dark",
          "data-f1-motion", "data-f1-instance"
        ]) root.removeAttribute(name);
      });
    }

    exports.inject = inject;
    exports.apply = apply;
