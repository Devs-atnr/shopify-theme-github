  (function () {
    document.querySelectorAll('.faq-section').forEach(function (section, idx) {
      var heading = section.querySelector('h2');
      if (!heading) return;

      // Make <h2> the interactive trigger
      heading.classList.add('accordion-trigger');
      heading.setAttribute('role', 'button');
      heading.setAttribute('tabindex', '0');
      heading.setAttribute('aria-expanded', 'false');
      heading.id = heading.id || ('faq-heading-' + (idx + 1));

      // Wrap all siblings after <h2> into .accordion-content
      var content = document.createElement('div');
      content.className = 'accordion-content';
      content.setAttribute('role', 'region');
      content.setAttribute('aria-labelledby', heading.id);

      var node = heading.nextSibling;
      while (node) {
        var next = node.nextSibling;
        content.appendChild(node);
        node = next;
      }
      section.appendChild(content);

      // Plus/Minus icon
      var icon = document.createElement('span');
      icon.className = 'accordion-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '+';
      heading.appendChild(icon);

      // Ensure correct height on load (collapsed)
      content.style.maxHeight = '0px';

      function openPanel() {
        heading.setAttribute('aria-expanded', 'true');
        icon.textContent = '−';
        // Set to scrollHeight for smooth transition
        content.style.maxHeight = content.scrollHeight + 'px';
      }

      function closePanel() {
        heading.setAttribute('aria-expanded', 'false');
        icon.textContent = '+';
        content.style.maxHeight = '0px';
      }

      function togglePanel() {
        var expanded = heading.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          closePanel();
        } else {
          openPanel();
        }
      }

      // Click + keyboard
      heading.addEventListener('click', togglePanel);
      heading.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          togglePanel();
        }
      });

      // Recompute height on resize (keeps animation smooth if content wraps)
      window.addEventListener('resize', function () {
        if (heading.getAttribute('aria-expanded') === 'true') {
          content.style.maxHeight = content.scrollHeight + 'px';
        }
      });
    });
  })();