export function installStarButtonStyles() {
  if (document.getElementById('same3le-star-button-styles')) return;

  const style = document.createElement('style');
  style.id = 'same3le-star-button-styles';
  style.textContent = `
    #starQuestionButton {
      min-width: 98px;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.78);
      background: rgba(255, 255, 255, 0.10);
      box-shadow: none;
      white-space: nowrap;
    }

    #starQuestionButton:hover:not(:disabled) {
      color: #ffffff;
      border-color: #ffffff;
      background: rgba(255, 255, 255, 0.18);
    }

    #starQuestionButton[aria-pressed="true"] {
      color: #ffffff;
      border-color: var(--primary);
      background: var(--primary);
    }

    #starQuestionButton:disabled {
      color: #ffffff;
    }
  `;
  document.head.append(style);
}
