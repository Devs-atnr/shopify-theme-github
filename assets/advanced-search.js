(function () {
	var DEBOUNCE_MS = 250;
	var PREDICTIVE_LIMIT = 10;
	var MAX_HYDRATE = 12;

	var openers = document.querySelectorAll('[data-advanced-search-open]');
	var closer = document.querySelector('[data-advanced-search-close]');
	var modal = document.getElementById('AdvancedSearchModal');
	var overlay = document.getElementById('AdvancedSearchOverlay');
	var tabButtons = document.querySelectorAll('.advanced-search__tab');
	var panels = document.querySelectorAll('.advanced-search__panel');
	var form = modal && modal.querySelector('.advanced-search__form');
	var searchInput = modal && modal.querySelector('[data-predictive-search-input]');
	var predictiveResults = modal && modal.querySelector('[data-predictive-search-results]');
	var trendingPanels = modal && modal.querySelector('[data-trending-panels]');
	var productsContainer = predictiveResults && predictiveResults.querySelector('[data-predictive-search-products]');
	var collectionsContainer = predictiveResults && predictiveResults.querySelector('[data-predictive-search-collections]');
	var vendorsContainer = predictiveResults && predictiveResults.querySelector('[data-predictive-search-vendors]');
	var card = modal && modal.querySelector('.advanced-search__card');

	var activeController = null;
	var searchTimeout = null;
	var productTagCache = new Map();
	var productAvailCache = new Map();
	var lastScopedCollections = [];

	function escapeForRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
	function normalize(str) { return (str || '').toLowerCase().trim(); }
	function getFocusableElements(root) {
		return Array.prototype.slice.call(
			root.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
		).filter(function (el) { return !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'); });
	}
	function getActiveScopeTags() {
		var active = Array.prototype.find.call(tabButtons, function (btn) {
			return btn.getAttribute('aria-selected') === 'true';
		});
		var scope = active ? (active.getAttribute('data-as-scope') || '').trim() : '';
		if (!scope) return [];
		return scope.split(',').map(function (t) { return normalize(t); }).filter(Boolean);
	}
	function showSpinner() {
		if (!predictiveResults) return;
		predictiveResults.hidden = false;
		if (productsContainer) productsContainer.style.display = 'block';
		if (collectionsContainer) collectionsContainer.style.display = 'block';
		if (vendorsContainer) vendorsContainer.style.display = 'block';
		if (productsContainer) productsContainer.innerHTML = '<div class="advanced-search__trending-title">Searching…</div>';
		if (collectionsContainer) collectionsContainer.innerHTML = '';
		if (vendorsContainer) vendorsContainer.innerHTML = '';
	}
	function clearResults() {
		if (!predictiveResults) return;
		if (productsContainer) productsContainer.innerHTML = '';
		if (collectionsContainer) collectionsContainer.innerHTML = '';
		if (vendorsContainer) vendorsContainer.innerHTML = '';
		predictiveResults.hidden = true;
	}
	function ensureTrendingVisible() { if (trendingPanels) trendingPanels.hidden = false; }
	function hideTrending() { if (trendingPanels) trendingPanels.hidden = true; }

	function openModal() {
		if (!modal || !overlay) return;
		modal.hidden = false;
		overlay.hidden = false;
		document.body.classList.add('advanced-search--open');
		requestAnimationFrame(function () { if (searchInput) searchInput.focus(); });

		var focusables = getFocusableElements(modal);
		function trap(e) {
			if (e.key !== 'Tab') return;
			var first = focusables[0];
			var last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				last.focus();
				e.preventDefault();
			} else if (!e.shiftKey && document.activeElement === last) {
				first.focus();
				e.preventDefault();
			}
		}
		modal._trapHandler = trap;
		document.addEventListener('keydown', trap);
	}
	function closeModal() {
		if (!modal || !overlay) return;
		modal.hidden = true;
		overlay.hidden = true;
		document.body.classList.remove('advanced-search--open');
		clearResults();
		ensureTrendingVisible();

		if (modal._trapHandler) {
			document.removeEventListener('keydown', modal._trapHandler);
			modal._trapHandler = null;
		}
	}

	function activateTab(target) {
		tabButtons.forEach(function (btn) {
			var isActive = btn.dataset.asTab === target;
			btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
			btn.tabIndex = isActive ? 0 : -1;
		});
		panels.forEach(function (panel) {
			var isMatch = panel.id === 'as-panel-' + target;
			panel.hidden = !isMatch;
		});
	}

	function fetchJSON(url, opts) {
		return fetch(url, opts).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.json();
		});
	}
	function abortActiveRequest() {
		if (activeController) {
			try { activeController.abort(); } catch (_) {}
			activeController = null;
		}
	}

	// Availability helpers
	function productIsAvailableKnown(p) {
		// Returns true/false if determinable, null if unknown
		if (typeof p.available === 'boolean') return p.available;
		if (Array.isArray(p.variants) && p.variants.length) {
			for (var i = 0; i < p.variants.length; i += 1) {
				var v = p.variants[i];
				if (v && typeof v.available === 'boolean' && v.available) return true;
				if (v && typeof v.inventory_quantity === 'number' && v.inventory_quantity > 0) return true;
			}
			return false;
		}
		return null;
	}

	function productsFilterByTagsAndAvailability(products, scopeTags) {
		function hasAnyTag(product, tags) {
			var productTags = [];
			if (Array.isArray(product.tags)) productTags = product.tags;
			else if (typeof product.tags === 'string') productTags = product.tags.split(',').map(function (t) { return t.trim(); });
			if (!tags.length) return true;
			var set = new Set(productTags.map(normalize));
			for (var i = 0; i < tags.length; i += 1) {
				if (set.has(normalize(tags[i]))) return true;
			}
			return false;
		}

		var immediate = [];
		var missing = [];

		(products || []).forEach(function (p) {
			// Fast path: skip if clearly OOS
			var avail = productIsAvailableKnown(p);
			if (avail === false) return;

			var hasTags = hasAnyTag(p, scopeTags);

			// If availability unknown or tags unknown (tags missing), hydrate later
			var tagsKnown = Array.isArray(p.tags) || typeof p.tags === 'string';
			if ((avail === null) || (!tagsKnown && scopeTags.length > 0)) {
				missing.push(p);
				return;
			}

			if (hasTags && (avail === true || avail === null)) {
				immediate.push(p);
			}
		});

		return { immediate: immediate, missing: missing.slice(0, MAX_HYDRATE) };
	}

	function fetchProductTagsOnce(p) {
		if (!p || !p.url) return Promise.resolve(p);
		if (productTagCache.has(p.url)) {
			p.tags = productTagCache.get(p.url);
			if (productAvailCache.has(p.url)) p.available = productAvailCache.get(p.url);
			return Promise.resolve(p);
		}
		return fetchJSON(p.url + '.js').then(function (j) {
			var tags = Array.isArray(j.tags) ? j.tags : String(j.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
			var available = false;
			if (typeof j.available === 'boolean') {
				available = j.available;
			} else if (Array.isArray(j.variants)) {
				available = j.variants.some(function (v) {
					return (v && v.available) || (typeof v.inventory_quantity === 'number' && v.inventory_quantity > 0);
				});
			}
			productTagCache.set(p.url, tags);
			productAvailCache.set(p.url, available);
			p.tags = tags;
			p.available = available;
			if (!p.vendor && j.vendor) p.vendor = j.vendor;
			return p;
		}).catch(function () { return p; });
	}

	function collectionsFilterByScope(collections, scopeTags) {
		return (collections || []).filter(function (c) {
			if (typeof c.products_count === 'number' && c.products_count <= 0) return false;
			if (!scopeTags.length) return true;
			var hay = normalize((c.handle || '') + ' ' + (c.title || ''));
			for (var i = 0; i < scopeTags.length; i += 1) {
				if (hay.indexOf(scopeTags[i]) !== -1) return true;
			}
			return false;
		});
	}

	function buildVendorsFromProducts(products, query, scopeTags) {
		var q = normalize(query);
		var seen = new Set();
		var out = [];
		(products || []).forEach(function (p) {
			var vendor = (p && p.vendor) ? String(p.vendor) : '';
			if (!vendor) return;
			// Only consider available products
			var avail = productIsAvailableKnown(p);
			if (avail === false) return;
			if (!scopeTags.length) {
				var vn = normalize(vendor);
				if (q && vn.indexOf(q) === -1) return;
			}
			var key = normalize(vendor);
			if (!seen.has(key)) {
				seen.add(key);
				out.push(vendor);
			}
		});
		return out.slice(0, 8);
	}

	function handlePredictiveSearch() {
		if (!searchInput || !predictiveResults || !trendingPanels) return;

		var query = searchInput.value.trim();
		var scopeTags = getActiveScopeTags();

		if (query.length < 2) {
			clearResults();
			ensureTrendingVisible();
			return;
		}

		hideTrending();
		showSpinner();
		abortActiveRequest();

		activeController = new AbortController();

		// Hide out-of-stock at the source if possible
		var url = '/search/suggest.json?q=' + encodeURIComponent(query)
			+ '&resources[type]=product,collection'
			+ '&resources[limit]=' + encodeURIComponent(PREDICTIVE_LIMIT)
			+ '&resources[options][prefix]=last'
			+ '&resources[options][unavailable_products]=hide';

		fetchJSON(url, { signal: activeController.signal })
			.then(function (data) {
				var products = (data && data.resources && data.resources.results && data.resources.results.products) || [];
				var collections = (data && data.resources && data.resources.results && data.resources.results.collections) || [];

				collections = collectionsFilterByScope(collections, scopeTags);
				lastScopedCollections = collections.slice();

				// Filter products by tags + availability; hydrate if unknown
				var split = productsFilterByTagsAndAvailability(products, scopeTags);

				var vendorsInitial = buildVendorsFromProducts(split.immediate, query, scopeTags);
				displayPredictiveResults(split.immediate, collections, vendorsInitial, query);

				if (split.missing.length > 0) {
					Promise.all(split.missing.map(fetchProductTagsOnce))
						.then(function (hydrated) {
							var merged = split.immediate.concat(
								hydrated.filter(function (p) {
									var avail = productIsAvailableKnown(p);
									if (avail === false) return false;
									// After hydration, ensure tag scope (if any) is respected
									if (!scopeTags.length) return avail !== false;
									var pTags = Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',').map(function (t) { return t.trim(); });
									var set = new Set(pTags.map(normalize));
									return scopeTags.some(function (t) { return set.has(t); });
								})
							);
							var vendorsMerged = buildVendorsFromProducts(merged, query, scopeTags);
							displayPredictiveResults(merged, lastScopedCollections, vendorsMerged, query);
						})
						.catch(function () {});
				}
			})
			.catch(function (e) {
				if (e && e.name === 'AbortError') return;
				clearResults();
				ensureTrendingVisible();
			})
			.finally(function () {
				activeController = null;
			});
	}

	function displayPredictiveResults(products, collections, vendors, query) {
		if (!predictiveResults) return;

		// PRODUCTS
		if (productsContainer) {
			if (!products || products.length === 0) {
				productsContainer.style.display = 'none';
				productsContainer.innerHTML = '';
			} else {
				productsContainer.style.display = 'block';
				var pHtml = '<h3 class="advanced-search__trending-title">PRODUCTS</h3><ul role="listbox">';
				products.forEach(function (product, idx) {
					var safeTitle = String(product.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					pHtml += '<li role="option"><a class="advanced-search__predictive-item" href="' + product.url + '" tabindex="-1" data-result-idx="' + idx + '">' + safeTitle + '</a></li>';
				});
				pHtml += '</ul>';
				productsContainer.innerHTML = pHtml;
			}
		}

		// COLLECTIONS
		if (collectionsContainer) {
			if (!collections || collections.length === 0) {
				collectionsContainer.style.display = 'none';
				collectionsContainer.innerHTML = '';
			} else {
				collectionsContainer.style.display = 'block';
				var cHtml = '<h3 class="advanced-search__trending-title">COLLECTIONS</h3><ul role="listbox">';
				collections.forEach(function (col, idx) {
					var label = String(col.title || col.handle || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					cHtml += '<li role="option"><a class="advanced-search__predictive-item" href="' + col.url + '" tabindex="-1" data-col-idx="' + idx + '">' + label + '</a></li>';
				});
				cHtml += '</ul>';
				collectionsContainer.innerHTML = cHtml;
			}
		}

		// VENDORS → route to search with vendor filter + current query
		if (vendorsContainer) {
			if (!vendors || vendors.length === 0) {
				vendorsContainer.style.display = 'none';
				vendorsContainer.innerHTML = '';
			} else {
				vendorsContainer.style.display = 'block';
				var vHtml = '<h3 class="advanced-search__trending-title">RELEVANT BRANDS</h3><ul role="listbox">';
				var baseQuery = String(query || '').trim();
				vendors.forEach(function (vendor, idx) {
					var safeVendor = String(vendor).replace(/</g, '&lt;').replace(/>/g, '&gt;');
					var vendorForQuery = String(vendor).replace(/"/g, '\\"');
					var qValue = baseQuery ? (baseQuery + ' AND vendor:"' + vendorForQuery + '"') : ('vendor:"' + vendorForQuery + '"');
					var url = '/search?q=' + encodeURIComponent(qValue) + '&type=product';
					vHtml += '<li role="option"><a class="advanced-search__predictive-item" href="' + url + '" tabindex="-1" data-vendor-idx="' + idx + '">' + safeVendor + '</a></li>';
				});
				vHtml += '</ul>';
				vendorsContainer.innerHTML = vHtml;
			}
		}

		var hasAnything = (products && products.length) || (collections && collections.length) || (vendors && vendors.length);
		predictiveResults.hidden = !hasAnything;
		if (!hasAnything) ensureTrendingVisible();
		else wireKeyboardNavigation();
	}

	function wireKeyboardNavigation() {
		if (!predictiveResults || !searchInput) return;
		var items = predictiveResults.querySelectorAll('.advanced-search__predictive-item');
		if (!items.length) return;

		items.forEach(function (a) { a.tabIndex = -1; a.classList.remove('is-active'); });
		var activeIndex = -1;

		function setActive(idx) {
			items.forEach(function (a) { a.classList.remove('is-active'); });
			if (idx >= 0 && idx < items.length) {
				items[idx].classList.add('is-active');
				items[idx].focus();
				activeIndex = idx;
			}
		}

		function onKey(e) {
			if (predictiveResults.hidden) return;
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setActive((activeIndex + 1) % items.length);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setActive((activeIndex - 1 + items.length) % items.length);
			} else if (e.key === 'Enter') {
				if (activeIndex >= 0 && activeIndex < items.length) {
					e.preventDefault();
					window.location.href = items[activeIndex].getAttribute('href');
				}
			}
		}

		if (!searchInput._predictiveKeyHandler) {
			searchInput._predictiveKeyHandler = onKey;
			searchInput.addEventListener('keydown', onKey);
		}
	}

	openers.forEach(function (btn) { btn.addEventListener('click', openModal); });
	if (closer) closer.addEventListener('click', closeModal);
	if (overlay) overlay.addEventListener('click', closeModal);

	document.addEventListener('mousedown', function (e) {
		if (!modal || modal.hidden) return;
		if (!card) return;
		if (!card.contains(e.target)) closeModal();
	});

	document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

	if (modal) {
		modal.addEventListener('click', function (e) {
			var a = e.target.closest('.advanced-search__predictive-item, .advanced-search__trending-chip');
			if (a) closeModal();
		});
	}

	tabButtons.forEach(function (btn) {
		btn.addEventListener('click', function () {
			activateTab(btn.dataset.asTab);
			if (searchInput && searchInput.value.trim().length >= 2) handlePredictiveSearch();
		});
		btn.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
				var idx = Array.prototype.indexOf.call(tabButtons, btn);
				var next = e.key === 'ArrowRight' ? (idx + 1) % tabButtons.length : (idx - 1 + tabButtons.length) % tabButtons.length;
				tabButtons[next].focus();
				activateTab(tabButtons[next].dataset.asTab);
				if (searchInput && searchInput.value.trim().length >= 2) handlePredictiveSearch();
			}
		});
	});

	if (searchInput) {
		searchInput.addEventListener('input', function () {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(handlePredictiveSearch, DEBOUNCE_MS);
		});
		searchInput.addEventListener('focus', function () {
			if (this.value.trim().length >= 2) handlePredictiveSearch();
		});
		searchInput.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') {
				this.value = '';
				abortActiveRequest();
				clearResults();
				ensureTrendingVisible();
			}
		});
	}

	if (form) {
		form.addEventListener('submit', function () {
			var input = form.querySelector('input[name="q"]');
			if (!input) return;
			var base = (input.value || '').trim();
			var scopeTags = getActiveScopeTags();
			if (!base || scopeTags.length === 0) return;

			var alreadyScoped = scopeTags.some(function (t) {
				return new RegExp('\\btag\\s*:\\s*"' + escapeForRegExp(t) + '"\\b', 'i').test(base);
			});
			if (alreadyScoped) return;

			function escapeForQueryTag(t) { return String(t).replace(/"/g, '\\"'); }
			var tagQuery = scopeTags.map(function (t) { return 'tag:"' + escapeForQueryTag(t) + '"'; }).join(' OR ');
			input.value = base + ' AND (' + tagQuery + ')';
		});
	}

	activateTab('all');

	function initTyping(wrapper) {
    var input = wrapper.querySelector('.header__search-opener-input');
    if (!input) return;

    var phrasesAttr = wrapper.getAttribute('data-typing') || '["T-shirt","Jeans"]';
    var phrases;
    try { phrases = JSON.parse(phrasesAttr); } catch (e) { phrases = ["T-shirt","Jeans"]; }
    if (!phrases.length) phrases = ["T-shirt","Jeans"];

    var prefix = (wrapper.getAttribute('data-prefix') || 'search for');

    var typeDelay = 90, eraseDelay = 50, holdDelay = 1200, gapDelay = 300;
    var p = 0, i = 0, dir = 1;

    function set(text) {
      input.placeholder = prefix + (text ? (' ' + text) : '');
    }

    function tick() {
      var word = String(phrases[p]);
      if (dir === 1) {
        if (i <= word.length) { set(word.slice(0, i++)); return setTimeout(tick, typeDelay); }
        dir = -1; return setTimeout(tick, holdDelay);
      } else {
        if (i > 0) { set(word.slice(0, --i)); return setTimeout(tick, eraseDelay); }
        dir = 1; p = (p + 1) % phrases.length; return setTimeout(tick, gapDelay);
      }
    }

    set(''); tick();
  }

  document.querySelectorAll('[data-advanced-search-open] .header__search-opener-field')
    .forEach(initTyping);
	})();