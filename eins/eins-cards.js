/* Shared card-art renderer for Eins and Eins Flip.
 * Cards are composited from the separate background and foreground PNGs.
 * Asset root is relative to eins/eins.html.
 */
(() => {
  "use strict";

  const ROOT = "../images/pieces/Eins/";
  const COLOR_NAMES = ["red", "yellow", "green", "blue"];
  const COLOR_LABELS = {
    red: "Red",
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    cyan: "Cyan",
    orange: "Orange",
    purple: "Purple",
    pink: "Pink",
  };

  const FACE_FILES = {
    number: (card) => String(card.value),
    draw2: () => "+2",
    skip: () => "skip",
    reverse: () => "reverse",
    wild: () => "drawUntilColour",
    wildDraw4: () => "drawFour",
  };

  const WILD_FILES = {
    wild: "drawUntilColour",
    wildDraw4: "drawFour",
  };

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function assetURL(path) {
    return ROOT + path.split("/").map(encodeURIComponent).join("/");
  }

  function getCardAssets(card, options = {}) {
    if (!card) return null;
    if (card.color === null || card.type === "wild" || card.type === "wildDraw4") {
      const activeColor = options.activeColor || null;
      const variant = options.variant || "eins";
      const side = options.side || "light";
      const undecidedBackground = variant === "flip" && side === "dark" ? "flip" : "standard";
      const background = activeColor
        ? `wild/bg/${activeColor}.png`
        : `wild/bg/${undecidedBackground}.png`;
      const foreground = `wild/fg/${card.faceFile || WILD_FILES[card.type] || "standard"}.png`;
      return {
        background: assetURL(background),
        foreground: assetURL(foreground),
      };
    }

    const faceFile = card.faceFile || (FACE_FILES[card.type]
      ? FACE_FILES[card.type](card)
      : String(card.value ?? card.type));
    return {
      background: assetURL(`cardBG/${card.color}.png`),
      foreground: assetURL(`cardFG/${faceFile}.png`),
    };
  }

  function cardLabel(card) {
    if (!card) return "Card";
    switch (card.type) {
      case "number": return `${card.color} ${card.value}`;
      case "draw2": return `${card.color} Draw Two`;
      case "skip": return `${card.color} Skip`;
      case "reverse": return `${card.color} Reverse`;
      case "wild": return "Wild — choose a colour";
      case "wildDraw4": return "Wild Draw Four";
      default: return "Card";
    }
  }

  function assetLoaded(image) {
    const art = image?.closest?.(".card-art");
    if (!art) return;
    const count = Number(art.dataset.loadedAssets || 0) + 1;
    art.dataset.loadedAssets = String(count);
    if (count >= 2) art.classList.add("has-assets");
  }

  function renderCard(card, options = {}) {
    const assets = getCardAssets(card, options);
    if (!assets) return "";
    const selected = options.selected ? " selected" : "";
    const disabled = options.disabled ? " disabled" : "";
    const activeColor = options.activeColor || card.color;
    const activeLabel = activeColor ? COLOR_LABELS[activeColor] || activeColor : "Wild";
    const title = cardLabel(card);
    const label = options.showLabel === false ? "" : `<span class="card-fallback-label">${escapeHTML(title)}</span>`;

    return `<button type="button" class="eins-card${selected}" data-card-id="${escapeHTML(card.id)}" aria-label="${escapeHTML(title)}" title="${escapeHTML(title)}"${disabled}>
      <span class="card-art" data-color="${escapeHTML(activeLabel)}">
        <img class="card-background" src="${assets.background}" alt="" draggable="false" onload="EinsCards.assetLoaded(this)" onerror="this.remove()">
        <img class="card-foreground" src="${assets.foreground}" alt="" draggable="false" onload="EinsCards.assetLoaded(this)" onerror="this.remove()">
        ${label}
      </span>
    </button>`;
  }

  function renderBack(options = {}) {
    const coverName = options.cover || (options.variant === "flip" ? "flip" : "standard");
    const url = assetURL(`covers/${coverName}.png`);
    return `<div class="eins-card card-back" aria-label="Draw pile">
      <span class="card-art">
        <img class="card-cover" src="${url}" alt="" draggable="false" onerror="this.remove()">
        <span class="card-back-fallback">EINS</span>
      </span>
    </div>`;
  }

  window.EinsCards = Object.freeze({
    ROOT,
    // Flip will use the same renderer with { variant: "flip", side: "light"|"dark" }.
    COLOR_NAMES,
    COLOR_LABELS,
    assetURL,
    getCardAssets,
    assetLoaded,
    cardLabel,
    renderCard,
    renderBack,
  });
})();
