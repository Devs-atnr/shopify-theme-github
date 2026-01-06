(function () {
// Hover Mega menu opening function
function bindMegaMenuHover(item) {
  let timeout;

  item.addEventListener("mouseenter", () => {
    clearTimeout(timeout);
    item.setAttribute("open", true);
  });

  item.addEventListener("mouseleave", () => {
    timeout = setTimeout(() => {
      item.removeAttribute("open");
    }, 200);
  });
}

document.querySelectorAll("details.mega-menu").forEach((menu) => {
  bindMegaMenuHover(menu);

  const tabs = menu.querySelectorAll(".mega-menu__tab");
  const panels = menu.querySelectorAll(".mega-menu__tab-panel");
  const allImages = menu.querySelectorAll(".mega-menu__image");

  // Child tabs logic (hover/focus/click)
  tabs.forEach((tab) => {
    const targetPanelId = tab.getAttribute("data-tab");
    const targetPanel = menu.querySelector(`.mega-menu__tab-panel[data-tab-id="${targetPanelId}"]`);

    const activateTab = () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      if (targetPanel) targetPanel.classList.add("active");

      // Show child preview image
      const imageId = `image-${targetPanelId.replace("coach", "child-")}`;
      const imageToShow = menu.querySelector(`#${imageId}`);
      allImages.forEach((img) => img.classList.remove("active"));
      if (imageToShow) imageToShow.classList.add("active");
    };

    tab.addEventListener("mouseenter", activateTab);
    tab.addEventListener("focus", activateTab);

    tab.addEventListener("click", () => {
      const url = tab.getAttribute("data-url");
      if (url) window.location.href = url;
    });
  });

  // Grandchild (nested) items logic
  const childItems = menu.querySelectorAll(".mega-menu__nested-item");
  childItems.forEach((item) => {
    const imageId = `image-${item.dataset.image}`;
    const targetImage = menu.querySelector(`#${imageId}`);

    const activateImage = () => {
      allImages.forEach((img) => img.classList.remove("active"));
      if (targetImage) targetImage.classList.add("active");
    };

    item.addEventListener("mouseenter", activateImage);
    item.addEventListener("focus", activateImage);

    item.addEventListener("click", () => {
      const url = item.dataset.url;
      if (url) window.location.href = url;
    });
  });
});
})();