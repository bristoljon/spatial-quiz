// Quiz content. Bundled into the Lambda only; the browser receives a
// stripped copy with no answers (see publicQuestion in scoring.js).
//
// Every question is answered by moving your avatar on the board. Where your
// avatar sits when the clock hits zero is your answer.
//
// Questions are grouped into rounds. A round marked `practice: true` is a
// warm-up: scores are wiped when it ends. Each player gets one of each
// power-up (see powers.js); settings.powerUps decides when used ones come back.
//
//   choice  options -> zones on a grid. Stand in the right one.
//           { options: [{id,text}], answer: id }
//   range   a number line. Score falls off with distance from the answer.
//           { min, max, step, unit?, answer, exact (abs, full pts), zeroAt (abs, 0 pts) }
//   xy      two axes. Score falls off with distance on the board.
//           { axes: {x:{label,min,max,step?}, y:{...}}, answer: {x,y}, exact?, zeroAt? (board fractions) }
//   wager   two sides. The further from the middle, the more you stake. Wrong side loses points.
//           { left: {text}, right: {text}, answer: 'left'|'right' }
//   image   a picture fills the board; the answer is a point on it. Score falls off with distance.
//           { image: {src, width, height, bounds?}, answer: {px,py} | {x,y} | {lat,lon} (+ label?), exact?, zeroAt? (board-width fractions) }
//           src is a path under web/public (or a full URL); width/height are the file's pixels.
//           Give the answer in pixels of the file, or in fractions of its width/height, or,
//           for an equirectangular map with bounds {north,south,west,east}, in lat/lon.
//           A box answer { box: {px,py,w,h} } scores full points anywhere inside it.
//           image.reveal: a second file (same size) shown once the answers are locked,
//           e.g. the labelled version. image.cover: a box, or a list of boxes, in the
//           same forms as a box answer, blanked out until then. Either one holds the
//           results back (like a video) until the host shows them.
//   video   a clip fills the board. The host plays it, pauses it, and starts the clock;
//           players guess where something ends up; the clip resumes, then the results.
//           { video: {src, width, height}, answer, exact?, zeroAt? } (answer forms as image)
//
// Any question can take clock: 'host' to wait for the host before counting down.
// A video can also give pauseAt (seconds): the host's player stops there by itself.

import { oopsRound } from './rounds/oops.js';

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
    // Bump: how close someone must be to get shoved (board fraction) and how
    // far the closest possible victim flies.
    bump: { radius: 0.2, push: 0.25 },
  },
  rounds: [
    // A round with `practice: true` is a dry run: everyone plays it for real,
    // the reveal shows the points as usual, and then every score goes back to
    // zero the moment the host moves on to the next round. Drop the flag (or
    // set it false) to make the round count.
    {
      id: 'r1',
      title: 'Practice',
      practice: true,
      questions: [
    {
      id: 'q1', type: 'choice', points: 10, timeLimit: 20,
      prompt: 'Practice. Which of these is the tallest?',
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
    {
      id: 'q5', type: 'image', points: 12, timeLimit: 30,
      prompt: 'Find Iceland.',
      // NASA Blue Marble, public domain. Whole globe, so lat/lon map straight onto it.
      image: { src: '/img/world.jpg', width: 1920, height: 960, bounds: { north: 90, south: -90, west: -180, east: 180 } },
      answer: { lat: 64.9, lon: -18.6, label: 'Iceland' },
      exact: 0.02, zeroAt: 0.2,
      note: 'Just south of the Arctic Circle, between Greenland and Norway.',
    },
    {
      id: 'q6', type: 'image', points: 12, timeLimit: 30,
      prompt: 'Find Tokyo.',
      // Unlabelled map while the clock runs; the version with cities marked
      // takes its place once the answers are in (same file size).
      image: { src: '/img/world.jpg', reveal: '/img/world-labelled.jpg', width: 1920, height: 960, bounds: { north: 90, south: -90, west: -180, east: 180 } },
      answer: { lat: 35.68, lon: 139.69, label: 'Tokyo' },
      exact: 0.02, zeroAt: 0.2,
      note: 'On Honshu, the biggest island, facing the Pacific. Greater Tokyo is home to about 37 million people.',
    },
    {
      id: 'q7', type: 'image', points: 12, timeLimit: 30,
      prompt: 'Australia is under the box. Stand where Sydney is.',
      // The cover hides the coastline until the answers are locked.
      image: { src: '/img/world.jpg', width: 1920, height: 960, bounds: { north: 90, south: -90, west: -180, east: 180 }, cover: { px: 1540, py: 515, w: 260, h: 215 } },
      answer: { lat: -33.87, lon: 151.21, label: 'Sydney' },
      exact: 0.02, zeroAt: 0.2,
      note: 'South-east coast. Canberra, the capital, is 250 km inland to the south-west.',
    },
    {
      id: 'q8', type: 'video', points: 12, timeLimit: 20,
      prompt: 'Where does the ball come to rest?',
      video: { src: '/video/ball.mp4', width: 1280, height: 720 },
      // A rendered 8s clip: the ball stops at pixel (681, 278) of 1280x720.
      answer: { px: 681, py: 278, label: 'It stops here' },
      exact: 0.03, zeroAt: 0.25,
      note: 'Pause it around 3 seconds in for a sporting chance.',
    },
      ],
    },
    {
      id: 'r2',
      title: 'The quiz',
      questions: [
    {
      id: 'q9', type: 'choice', points: 10, timeLimit: 20,
      prompt: 'Which planet has the most moons?',
      options: [
        { id: 'a', text: 'Jupiter' }, { id: 'b', text: 'Saturn' }, { id: 'c', text: 'Uranus' },
        { id: 'd', text: 'Neptune' }, { id: 'e', text: 'Mars' }, { id: 'f', text: 'Earth' },
      ],
      answer: 'b',
      note: 'Saturn, with 274 confirmed moons as of 2025. Jupiter has 95.',
    },
    {
      id: 'q10', type: 'range', points: 10, timeLimit: 25,
      prompt: 'What percentage of the Earth\'s surface is covered by water?',
      min: 0, max: 100, step: 0.5, unit: '%', answer: 71, exact: 1, zeroAt: 20,
      note: 'About 71%. Only about 3% of that water is fresh.',
    },
    {
      id: 'q11', type: 'xy', points: 12, timeLimit: 35,
      prompt: 'Place Mount Everest by height and the year it was first summited.',
      axes: {
        x: { label: 'First summit (year)', min: 1900, max: 2000, step: 1 },
        y: { label: 'Height (m)', min: 6000, max: 10000, step: 10 },
      },
      answer: { x: 1953, y: 8849 },
      note: '8,849 m, first climbed by Hillary and Tenzing on 29 May 1953.',
    },
    {
      id: 'q12', type: 'image', points: 12, timeLimit: 30,
      prompt: 'Find Easter Island.',
      image: { src: '/img/world.jpg', width: 1920, height: 960, bounds: { north: 90, south: -90, west: -180, east: 180 } },
      answer: { lat: -27.1, lon: -109.35, label: 'Easter Island' },
      exact: 0.02, zeroAt: 0.2,
      note: 'Rapa Nui, 3,500 km west of Chile. Home to nearly 900 moai.',
    },
    {
      id: 'q13', type: 'wager', points: 15, timeLimit: 20,
      prompt: 'Final wager. Octopuses have three hearts.',
      left: { text: 'True' }, right: { text: 'False' },
      answer: 'left',
      note: 'True. Two pump blood to the gills, one to the rest of the body. Their blood is blue.',
    },
      ],
    },
    // "Where does it end up?" clips from the Oops! dataset; built with tools/oops.
    ...(oopsRound.questions.length ? [oopsRound] : []),
  ],
};

// Flat list used by the engine. Each question knows its round so power-ups
// can replenish when the round changes.
export const questions = quiz.rounds.flatMap((r, round) =>
  r.questions.map((q, indexInRound) => ({ ...q, round, roundTitle: r.title, practice: !!r.practice, indexInRound, roundTotal: r.questions.length })),
);
