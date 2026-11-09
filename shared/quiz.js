// Quiz content. Bundled into the Lambda only; the browser receives a
// stripped copy with no answers (see publicQuestion in scoring.js).
//
// Every question is answered by moving your avatar on the board. Where your
// avatar sits when the clock hits zero is your answer.
//
// Questions are grouped into rounds. Each player gets one of each power-up
// (see powers.js); settings.powerUps decides when used ones come back.
//
//   choice  options -> zones on a grid. Stand in the right one.
//           { options: [{id,text}], answer: id }
//   range   a number line. Score falls off with distance from the answer.
//           { min, max, step, unit?, answer, exact (abs, full pts), zeroAt (abs, 0 pts) }
//   xy      two axes. Score falls off with distance on the board.
//           { axes: {x:{label,min,max,step?}, y:{...}}, answer: {x,y}, exact?, zeroAt? (board fractions) }
//   wager   two sides. The further from the middle, the more you stake. Wrong side loses points.
//           { left: {text}, right: {text}, answer: 'left'|'right' }

export const quiz = {
  id: 'spatial-demo-1',
  title: 'Spatial Quiz',
  subtitle: 'Move to answer',
  settings: {
    // Extra points for the correct player who settled on their answer first
    // (by the time of their last move). 0 disables it.
    speedBonus: 1,
    // When used power-ups come back:
    //   'never'  - one of each for the whole quiz
    //   'round'  - one of each per round
    //   'random' - at the start of each question there's a `randomChance`
    //              that everyone's power-ups are refreshed (announced on screen)
    powerUps: { replenish: 'round', randomChance: 0.3 },
  },
  rounds: [
    {
      id: 'r1',
      title: 'Warm-up',
      questions: [
    {
      id: 'q1', type: 'choice', points: 10, timeLimit: 20,
      prompt: 'Warm-up. Which of these is the tallest?',
      options: [
        { id: 'a', text: 'Eiffel Tower' }, { id: 'b', text: 'The Shard' },
        { id: 'c', text: 'Blackpool Tower' }, { id: 'd', text: 'Big Ben' },
      ],
      answer: 'a',
      note: 'Eiffel Tower 330 m · The Shard 310 m · Blackpool Tower 158 m · Elizabeth Tower 96 m',
    },
    {
      id: 'q2', type: 'range', points: 10, timeLimit: 25,
      prompt: 'How many bones are in an adult human body?',
      min: 100, max: 400, step: 1, answer: 206, exact: 3, zeroAt: 60,
      note: '206. Babies start with around 270; many fuse as you grow.',
    },
    {
      id: 'q3', type: 'wager', points: 10, timeLimit: 20,
      prompt: 'A group of flamingos is called a "flamboyance".',
      left: { text: 'True' }, right: { text: 'False' },
      answer: 'left',
      note: 'True. And a group of owls is a parliament.',
    },
    {
      id: 'q4', type: 'xy', points: 12, timeLimit: 35,
      prompt: 'Place the launch of the first iPhone: which year, and what did it cost in the US (4GB model)?',
      axes: {
        x: { label: 'Year', min: 2000, max: 2015, step: 1 },
        y: { label: 'Price ($)', min: 0, max: 1000, step: 10 },
      },
      answer: { x: 2007, y: 499 },
      exact: 0.03, zeroAt: 0.35,
      note: 'June 2007, $499 for the 4GB model on a two-year contract.',
    },
      ],
    },
    {
      id: 'r2',
      title: 'Harder',
      questions: [
    {
      id: 'q5', type: 'choice', points: 10, timeLimit: 20,
      prompt: 'Which planet has the most moons?',
      options: [
        { id: 'a', text: 'Jupiter' }, { id: 'b', text: 'Saturn' }, { id: 'c', text: 'Uranus' },
        { id: 'd', text: 'Neptune' }, { id: 'e', text: 'Mars' }, { id: 'f', text: 'Earth' },
      ],
      answer: 'b',
      note: 'Saturn, with 274 confirmed moons as of 2025. Jupiter has 95.',
    },
    {
      id: 'q6', type: 'range', points: 10, timeLimit: 25,
      prompt: 'What percentage of the Earth\'s surface is covered by water?',
      min: 0, max: 100, step: 0.5, unit: '%', answer: 71, exact: 1, zeroAt: 20,
      note: 'About 71%. Only about 3% of that water is fresh.',
    },
    {
      id: 'q7', type: 'xy', points: 12, timeLimit: 35,
      prompt: 'Place Mount Everest by height and the year it was first summited.',
      axes: {
        x: { label: 'First summit (year)', min: 1900, max: 2000, step: 1 },
        y: { label: 'Height (m)', min: 6000, max: 10000, step: 10 },
      },
      answer: { x: 1953, y: 8849 },
      note: '8,849 m, first climbed by Hillary and Tenzing on 29 May 1953.',
    },
    {
      id: 'q8', type: 'wager', points: 15, timeLimit: 20,
      prompt: 'Final wager. Octopuses have three hearts.',
      left: { text: 'True' }, right: { text: 'False' },
      answer: 'left',
      note: 'True. Two pump blood to the gills, one to the rest of the body. Their blood is blue.',
    },
      ],
    },
  ],
};

// Flat list used by the engine. Each question knows its round so power-ups
// can replenish when the round changes.
export const questions = quiz.rounds.flatMap((r, round) =>
  r.questions.map((q, indexInRound) => ({ ...q, round, roundTitle: r.title, indexInRound, roundTotal: r.questions.length })),
);
