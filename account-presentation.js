let signInPanel = null;
let modalBackdrop = null;
let modalCloseButton = null;
let originalParent = null;
let originalNextSibling = null;
let modalOpen = false;
let initialized = false;

export function shouldPresentSignInModal({ signInPanelHidden = true } = {}) {
  return signInPanelHidden === false;
}

function installStyles() {
  if (document.getElementById('same3le-account-presentation-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-account-presentation-styles';
  style.textContent = `
    .account-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(17, 17, 17, 0.62);
      backdrop-filter: blur(5px);
    }

    body.same3le-account-modal-open {
      overflow: hidden;
    }

    #signInPanel.same3le-account-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 1001;
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      margin: 0 !important;
      overflow: auto;
      transform: translate(-50%, -50%);
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
    }

    .account-modal-close {
      position: sticky;
      top: 0;
      float: right;
      z-index: 1;
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      margin: -5px -5px 4px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      font-size: 1.1rem;
      font-weight: 800;
      cursor: pointer;
    }

    .account-modal-close:hover,
    .account-modal-close:focus-visible {
      border-color: var(--ink);
    }

    /*
     * Keep the existing My decks DOM available in the focused workspace.
     * Nothing is cloned and the existing delegated Study/Rename/Remove handlers
     * remain attached to #myDecksList.
     */
    body[data-same3le-workspace="ready"] #your-questions.source-workspace-collapsed,
    body[data-same3le-workspace="session"] #your-questions.source-workspace-collapsed {
      display: block !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    body[data-same3le-workspace="ready"] #your-questions.source-workspace-collapsed > :not(#myDecksPanel),
    body[data-same3le-workspace="session"] #your-questions.source-workspace-collapsed > :not(#myDecksPanel) {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #your-questions.source-workspace-collapsed > #myDecksPanel[hidden],
    body[data-same3le-workspace="session"] #your-questions.source-workspace-collapsed > #myDecksPanel[hidden] {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #your-questions.source-workspace-collapsed:has(> #myDecksPanel[hidden]),
    body[data-same3le-workspace="session"] #your-questions.source-workspace-collapsed:has(> #myDecksPanel[hidden]) {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #myDecksPanel,
    body[data-same3le-workspace="session"] #myDecksPanel {
      margin: 0;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
    }

    body[data-same3le-workspace="ready"] #myDecksPanel .my-decks-heading,
    body[data-same3le-workspace="session"] #myDecksPanel .my-decks-heading {
      margin: 0 0 8px;
    }

    body[data-same3le-workspace="ready"] #myDecksPanel .my-decks-heading .option-kicker,
    body[data-same3le-workspace="session"] #myDecksPanel .my-decks-heading .option-kicker,
    body[data-same3le-workspace="ready"] #myDecksPanel .my-decks-heading .panel-copy,
    body[data-same3le-workspace="session"] #myDecksPanel .my-decks-heading .panel-copy {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #my-decks-heading,
    body[data-same3le-workspace="session"] #my-decks-heading {
      margin: 0;
      font-size: 0.76rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    body[data-same3le-workspace="ready"] #myDecksList,
    body[data-same3le-workspace="session"] #myDecksList {
      display: flex;
      gap: 8px;
      padding: 1px 1px 4px;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scrollbar-width: thin;
    }

    body[data-same3le-workspace="ready"] #myDecksList .deck-card,
    body[data-same3le-workspace="session"] #myDecksList .deck-card {
      flex: 0 0 auto;
      min-width: 190px;
      max-width: 250px;
      padding: 9px 10px;
      border-radius: 12px;
      box-shadow: none;
    }

    body[data-same3le-workspace="ready"] #myDecksList .deck-card-copy h3,
    body[data-same3le-workspace="session"] #myDecksList .deck-card-copy h3 {
      max-width: 210px;
      margin: 0 0 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.88rem;
    }

    body[data-same3le-workspace="ready"] #myDecksList .deck-source-type,
    body[data-same3le-workspace="session"] #myDecksList .deck-source-type,
    body[data-same3le-workspace="ready"] #myDecksList .deck-opened,
    body[data-same3le-workspace="session"] #myDecksList .deck-opened,
    body[data-same3le-workspace="ready"] #myDecksList [data-deck-rename],
    body[data-same3le-workspace="session"] #myDecksList [data-deck-rename],
    body[data-same3le-workspace="ready"] #myDecksList [data-deck-remove],
    body[data-same3le-workspace="session"] #myDecksList [data-deck-remove],
    body[data-same3le-workspace="ready"] #myDecksList .deck-rename-form,
    body[data-same3le-workspace="session"] #myDecksList .deck-rename-form {
      display: none !important;
    }

    body[data-same3le-workspace="ready"] #myDecksList .deck-card-actions,
    body[data-same3le-workspace="session"] #myDecksList .deck-card-actions {
      margin: 0;
    }

    body[data-same3le-workspace="ready"] #myDecksList [data-deck-study],
    body[data-same3le-workspace="session"] #myDecksList [data-deck-study] {
      min-height: 0;
      padding: 7px 10px;
      font-size: 0.78rem;
    }

    body[data-same3le-workspace="ready"] #myDecksEmpty,
    body[data-same3le-workspace="session"] #myDecksEmpty,
    body[data-same3le-workspace="ready"] #myDecksStatus,
    body[data-same3le-workspace="session"] #myDecksStatus {
      margin: 6px 0 0;
      font-size: 0.78rem;
    }

    @media (max-width: 640px) {
      #signInPanel.same3le-account-modal {
        width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
      }

      body[data-same3le-workspace="ready"] #myDecksPanel,
      body[data-same3le-workspace="session"] #myDecksPanel {
        padding: 10px;
      }
    }
  `;
  document.head.append(style);
}

function ensureBackdrop() {
  if (modalBackdrop) return modalBackdrop;
  modalBackdrop = document.createElement('div');
  modalBackdrop.id = 'accountModalBackdrop';
  modalBackdrop.className = 'account-modal-backdrop';
  modalBackdrop.hidden = true;
  modalBackdrop.setAttribute('aria-hidden', 'true');
  document.body.append(modalBackdrop);
  return modalBackdrop;
}

function ensureCloseButton() {
  if (!signInPanel) return null;
  modalCloseButton = signInPanel.querySelector('#accountModalClose');
  if (modalCloseButton) return modalCloseButton;

  modalCloseButton = document.createElement('button');
  modalCloseButton.id = 'accountModalClose';
  modalCloseButton.className = 'account-modal-close';
  modalCloseButton.type = 'button';
  modalCloseButton.setAttribute('aria-label', 'Close sign in');
  modalCloseButton.textContent = '×';
  signInPanel.prepend(modalCloseButton);
  return modalCloseButton;
}

function focusModalField() {
  window.requestAnimationFrame(() => {
    const otpForm = document.querySelector('#otpForm');
    const target = otpForm && !otpForm.hidden
      ? document.querySelector('#otpCode')
      : document.querySelector('#accountEmail');
    target?.focus({ preventScroll: true });
  });
}

export function openAccountModal() {
  if (!signInPanel || signInPanel.hidden || modalOpen) return false;

  originalParent = signInPanel.parentNode;
  originalNextSibling = signInPanel.nextSibling;
  ensureBackdrop();
  ensureCloseButton();

  document.body.append(signInPanel);
  signInPanel.classList.add('same3le-account-modal');
  signInPanel.setAttribute('role', 'dialog');
  signInPanel.setAttribute('aria-modal', 'true');
  signInPanel.setAttribute('aria-label', 'Sign in to same3le');
  modalBackdrop.hidden = false;
  document.body.classList.add('same3le-account-modal-open');
  modalOpen = true;
  focusModalField();
  return true;
}

export function closeAccountModal({ restoreFocus = true } = {}) {
  if (!modalOpen || !signInPanel) return false;

  signInPanel.classList.remove('same3le-account-modal');
  signInPanel.removeAttribute('role');
  signInPanel.removeAttribute('aria-modal');
  signInPanel.removeAttribute('aria-label');
  if (modalBackdrop) modalBackdrop.hidden = true;
  document.body.classList.remove('same3le-account-modal-open');

  if (originalParent) {
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(signInPanel, originalNextSibling);
    } else {
      originalParent.append(signInPanel);
    }
  }

  modalOpen = false;
  if (restoreFocus) document.querySelector('#accountHeaderButton')?.focus({ preventScroll: true });
  return true;
}

function trapModalFocus(event) {
  if (!modalOpen || event.key !== 'Tab' || !signInPanel) return;
  const focusable = [...signInPanel.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), a[href], select:not([disabled]), textarea:not([disabled])')]
    .filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function captureAccountEntry(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('#accountHeaderButton')) return;
  if (!shouldPresentSignInModal({ signInPanelHidden: Boolean(signInPanel?.hidden) })) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openAccountModal();
}

export function setupAccountPresentation() {
  if (initialized) return;
  signInPanel = document.querySelector('#signInPanel');
  if (!signInPanel) return;

  initialized = true;
  installStyles();
  ensureBackdrop();
  ensureCloseButton();

  document.addEventListener('click', captureAccountEntry, true);
  document.addEventListener('keydown', (event) => {
    if (!modalOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAccountModal();
      return;
    }
    trapModalFocus(event);
  });

  modalBackdrop.addEventListener('click', () => closeAccountModal());
  modalCloseButton.addEventListener('click', () => closeAccountModal());

  const observer = new MutationObserver(() => {
    if (modalOpen && signInPanel.hidden) closeAccountModal({ restoreFocus: false });
  });
  observer.observe(signInPanel, { attributes: true, attributeFilter: ['hidden'] });
}
