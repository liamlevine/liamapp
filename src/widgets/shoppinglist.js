import { h } from "../core/ui.js";
import { ICONS } from "../core/icons.js";

const SITE = "https://daisylist1.web.app";

export const shoppingList = {
  id: "shopping",
  name: "shoppinglist.",
  tagline: "daisylist - your shopping list.",
  icon: "cart",
  code: "LIST",
  meta: "DAISYLIST1.WEB.APP",
  accent: "#2a5ce0",
  mount(root) {
    root.classList.add("shop");

    root.replaceChildren(
      h("div", { class: "embed-head" },
        h("a", {
          class: "back",
          href: "#/",
          html: `<span class="back-icon">${ICONS.back}</span><span>Widgets</span>`,
        }),
        h("div", { class: "embed-brand" },
          h("span", { class: "embed-brand-mark", html: ICONS.cart }),
          h("span", { class: "embed-brand-name" }, "shopping list"),
        ),
        h("span", { class: "embed-host" }, "daisylist1.web.app"),
        h("a", { class: "btn embed-open", href: SITE, target: "_blank", rel: "noopener" }, "Open ↗"),
      ),
      h("iframe", {
        class: "embed-frame",
        src: SITE,
        title: "Daisy List",
        allow: "fullscreen",
      }),
    );

    return () => {
      root.replaceChildren();
      root.classList.remove("shop");
    };
  },
};
