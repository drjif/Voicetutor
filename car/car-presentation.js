function installStyles() {
  if (document.getElementById('same3le-car-study-layout-styles')) return;
  const style = document.createElement('style');
  style.id = 'same3le-car-study-layout-styles';
  style.textContent = `
    .car-reveal-controls {
      display: grid;
      margin-top: 14px;
    }

    .car-reveal-controls .button {
      width: 100%;
      min-height: 64px;
      font-size: 20px;
    }

    #drivePanel .primary-controls {
      grid-template-columns: 1fr;
    }

    #drivePanel .transport-grid {
      grid-template-columns: 1fr 1fr;
      margin-top: 14px;
    }

    .car-star-controls {
      display: grid;
      margin-top: 14px;
    }

    .car-star-controls .button {
      width: 100%;
      min-height: 64px;
      font-size: 20px;
    }

    @media (max-width: 760px) {
      #drivePanel .transport-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
}

function installCarStudyLayout() {
  const drivePanel = document.querySelector('#drivePanel');
  const questionCard = document.querySelector('#questionText')?.closest('.question-card');
  const answerCard = document.querySelector('#answerCard');
  const revealButton = document.querySelector('#revealButton');
  const starButton = document.querySelector('#starButton');
  const previousButton = document.querySelector('#previousButton');
  const nextButton = document.querySelector('#nextButton');
  const primaryControls = document.querySelector('.primary-controls');
  const transportGrid = document.querySelector('.transport-grid');

  if (!drivePanel || !questionCard || !answerCard || !revealButton || !starButton || !previousButton || !nextButton || !primaryControls || !transportGrid) return;

  installStyles();

  questionCard.insertAdjacentElement('beforebegin', primaryControls);

  let revealControls = document.querySelector('#carRevealControls');
  if (!revealControls) {
    revealControls = document.createElement('div');
    revealControls.id = 'carRevealControls';
    revealControls.className = 'car-reveal-controls';
    questionCard.insertAdjacentElement('afterend', revealControls);
  }
  revealControls.append(revealButton);

  answerCard.insertAdjacentElement('afterend', transportGrid);
  transportGrid.append(previousButton, nextButton);

  let starControls = document.querySelector('#carStarControls');
  if (!starControls) {
    starControls = document.createElement('div');
    starControls.id = 'carStarControls';
    starControls.className = 'car-star-controls';
    transportGrid.insertAdjacentElement('afterend', starControls);
  }
  starControls.append(starButton);
}

installCarStudyLayout();
