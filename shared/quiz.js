// The quiz content. This file is bundled into the Netlify Functions only, so
// answers never ship to players' phones. The client only ever sees the
// "public" version of a question (see shared/public.js).
//
// Media: any value written as "media:<file>" refers to a file in /quiz-media.
// `npm run prep` resizes/crops them into /public/m with unguessable names.
// Missing files get a labelled placeholder so the quiz still runs.
//
// Question types
//   choice  - single answer. options: [{id, text?, image?}], answer: id
//             optional quote: {text, stars, title} renders a review card
//   multi   - pick all that apply. answer: [ids]  (partial credit)
//   order   - put items in order. items: [{id,text}], answer: [ids in order]
//   match   - pair left with right. left/right: [{id,text}], answer: {leftId: rightId}
//   blanks  - text with {0},{1}.. gaps. blanks: [{accept:[...], options?:[...]}]
//   slider  - number guess. min,max,step,unit, answer, exact (full pts within), zeroAt
//   text    - free text. accept: [...]
//   reveal  - photo zoom-out. media, focus:{x,y}, stages, then either
//             options+answer (choice) or accept (text). Fewer stages seen = more points.

export const quiz = {
  id: 'stroud-2026',
  title: 'Tech Department Quiz',
  subtitle: 'November 2026',
  rounds: [
    // ------------------------------------------------------------------
    // {
    //   id: 'r1',
    //   title: 'Guess the Establishment',
    //   intro: 'Real reviews of real Stroud-area venues. Name the place.',
    //   questions: [
    //     {
    //       id: 'r1q1', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Warm-up. Which venue earned this review, titled "Nice principles, awful ground"?',
    //       quote: { stars: 1, text: 'The pie was hated by my wife who likes vegetarian food. She got the better deal as the burger was tasteless mush.' },
    //       options: [
    //         { id: 'a', text: 'Stroud Rugby Club, Fromehall Park' },
    //         { id: 'b', text: 'The New Lawn, Forest Green Rovers' },
    //         { id: 'c', text: 'Stratford Park Leisure Centre' },
    //         { id: 'd', text: 'Shortwood United FC' },
    //       ],
    //       answer: 'b',
    //       note: 'The New Lawn, Nailsworth. The world\'s first vegan football club. Another reviewer: "Vegan sausage rolls were nice."',
    //     },
    //     {
    //       id: 'r1q2', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Which venue earned this 1-star review?',
    //       quote: { stars: 1, text: 'Two of us ordered BBQ chicken with chips, peas and mushroom. Yes, mushroom, singular.' },
    //       options: [
    //         { id: 'a', text: 'The Golden Fleece' },
    //         { id: 'b', text: 'Stroud Brewery Taproom' },
    //         { id: 'c', text: 'The Lord John (Wetherspoon)' },
    //         { id: 'd', text: 'The Crown & Sceptre' },
    //       ],
    //       answer: 'c',
    //       note: 'The Lord John, Russell Street. Another reviewer: "I have never seen a pizza base served up as a pizza before."',
    //     },
    //     {
    //       id: 'r1q3', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Where did this visitor have concerns about the knots display?',
    //       quote: { stars: 1, text: '...none of these appeared to be correctly tied as explained by a qualified person.' },
    //       options: [
    //         { id: 'a', text: 'Stroud Valleys Artspace (SVA)' },
    //         { id: 'b', text: 'Gloucester Waterways Museum' },
    //         { id: 'c', text: 'Woodchester Mansion' },
    //         { id: 'd', text: 'Museum in the Park' },
    //       ],
    //       answer: 'd',
    //       note: 'Museum in the Park, Stratford Park. Its collection includes one of the world\'s first lawnmowers, invented in Thrupp.',
    //     },
    //     {
    //       id: 'r1q4', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Which venue is this 3-star review about?',
    //       quote: { stars: 3, text: 'Loved the beer, shame about the vegan sausages... I can recommend Sainsbury\'s Shroomdogs or Waitrose\'s plant based herby sausages as alternatives.' },
    //       options: [
    //         { id: 'a', text: 'Stroud Brewery' },
    //         { id: 'b', text: 'The Prince Albert' },
    //         { id: 'c', text: 'Karibu Vegan Bar & Kitchen' },
    //         { id: 'd', text: 'The Ale House' },
    //       ],
    //       answer: 'a',
    //       note: 'Stroud Brewery, Thrupp. Helpful supermarket recommendations included free of charge.',
    //     },
    //     {
    //       id: 'r1q5', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Name the venue.',
    //       quote: { stars: null, text: 'Was going to eat in the food hall, but we left because there was an awful sounding busker... management should audition them.' },
    //       options: [
    //         { id: 'a', text: 'Stroud Farmers\' Market' },
    //         { id: 'b', text: 'The Shambles Market' },
    //         { id: 'c', text: 'Five Valleys Shopping Centre' },
    //         { id: 'd', text: 'Nailsworth Farmers\' Market' },
    //       ],
    //       answer: 'c',
    //       note: 'Five Valleys. Another reviewer: "Merrywalks was a better name, why does everything in this town have to be called Five Valleys?"',
    //     },
    //     {
    //       id: 'r1q6', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Where were they handed a wooden stick?',
    //       quote: { stars: 3, text: 'We were given a wooden stick to eat the ice cream with, which is tricky when it\'s melting.' },
    //       options: [
    //         { id: 'a', text: 'Henry\'s Bakehouse Cafe' },
    //         { id: 'b', text: 'Winstones Ice Cream' },
    //         { id: 'c', text: 'The Bear of Rodborough' },
    //         { id: 'd', text: 'Lavender Bakehouse' },
    //       ],
    //       answer: 'b',
    //       note: 'Winstones, Rodborough Common, since 1925. Another review: "Waffles... not available in summer due to high demand."',
    //     },
    //     {
    //       id: 'r1q7', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'A 5-star review, titled "Beautiful drifts of snowdrops". Where?',
    //       quote: { stars: 5, text: 'Parking well organised and upmarket portaloos on site.' },
    //       options: [
    //         { id: 'a', text: 'Woodchester Park' },
    //         { id: 'b', text: 'Stratford Park' },
    //         { id: 'c', text: 'Painswick Rococo Garden' },
    //         { id: 'd', text: 'Prinknash Abbey' },
    //       ],
    //       answer: 'c',
    //       note: 'Painswick Rococo Garden. A different visitor disagreed: "Portaloos are bad enough at festivals..."',
    //     },
    //     {
    //       id: 'r1q8', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Which spooky spot is this?',
    //       quote: { stars: 5, text: 'A spooky tour through a huge house where no one ever lived (well almost no one)... Great colonies of bats now live here.' },
    //       options: [
    //         { id: 'a', text: 'Owlpen Manor' },
    //         { id: 'b', text: 'Woodchester Mansion' },
    //         { id: 'c', text: 'Painswick House' },
    //         { id: 'd', text: 'Museum in the Park' },
    //       ],
    //       answer: 'b',
    //       note: 'Woodchester Mansion. Work stopped in 1873 and it was never finished. Now home to about 200 greater horseshoe bats.',
    //     },
    //     {
    //       id: 'r1q9', type: 'choice', points: 10, timeLimit: 30,
    //       prompt: 'Last one. Where should you "not expect a £1 loaf of bread"?',
    //       quote: { stars: null, text: 'Highly recommended. But do not expect a £1 loaf of bread.' },
    //       options: [
    //         { id: 'a', text: 'Hobbs House Bakery, Nailsworth' },
    //         { id: 'b', text: 'Hall\'s Quality Bakers' },
    //         { id: 'c', text: 'Woodruffs' },
    //         { id: 'd', text: 'Greggs, Five Valleys' },
    //       ],
    //       answer: 'a',
    //       note: 'Hobbs House Bakery: home of TV\'s Fabulous Baker Brothers.',
    //     },
    //   ],
    // },
    // ------------------------------------------------------------------
    // {
    //   id: 'r2',
    //   title: 'Guess the Demographics',
    //   intro: 'Census 2021. Stroud vs Bristol, London and friends.',
    //   questions: [
    //     {
    //       id: 'r2q1', type: 'choice', points: 10, timeLimit: 25,
    //       prompt: 'Which of these has the highest share of people with no religion?',
    //       options: [
    //         { id: 'a', text: 'Stroud' }, { id: 'b', text: 'Bristol' },
    //         { id: 'c', text: 'London' }, { id: 'd', text: 'Brighton & Hove' },
    //       ],
    //       answer: 'd',
    //       note: 'Brighton & Hove 55.2% (highest in England) · Bristol 51.4% · Stroud 44.1% · London 27.1%',
    //     },
    //     {
    //       id: 'r2q2', type: 'slider', points: 10, timeLimit: 30,
    //       prompt: 'What percentage of Stroud residents said they have no religion?',
    //       min: 0, max: 100, step: 0.5, unit: '%', answer: 44.1, exact: 2, zeroAt: 20,
    //       note: '44.1%, well above England\'s 36.7%. The number with no religion rose 67% since 2011.',
    //     },
    //     {
    //       id: 'r2q3', type: 'order', points: 12, timeLimit: 45,
    //       prompt: 'Order by median age, youngest first.',
    //       labels: { first: 'Youngest', last: 'Oldest' },
    //       items: [
    //         { id: 'stroud', text: 'Stroud' }, { id: 'bristol', text: 'Bristol' },
    //         { id: 'cots', text: 'Cotswold' }, { id: 'london', text: 'London' },
    //         { id: 'glos', text: 'Gloucester' }, { id: 'brighton', text: 'Brighton & Hove' },
    //       ],
    //       answer: ['bristol', 'london', 'brighton', 'glos', 'stroud', 'cots'],
    //       values: { bristol: '34', london: '35', brighton: '38', glos: '39', stroud: '47', cots: '49' },
    //       note: 'Median ages: Bristol 34 · London 35 · Brighton 38 · Gloucester 39 · Stroud 47 · Cotswold 49',
    //     },
    //     {
    //       id: 'r2q4', type: 'slider', points: 10, timeLimit: 30,
    //       prompt: 'What percentage of Stroud residents are White British?',
    //       min: 0, max: 100, step: 0.5, unit: '%', answer: 92.4, exact: 2, zeroAt: 20,
    //       note: 'Stroud 92.4% · England 73.5% · Bristol 71.6% · London 37%',
    //     },
    //     {
    //       id: 'r2q5', type: 'multi', points: 10, timeLimit: 35,
    //       prompt: 'Lockdown special. Where did MORE than 40% of workers mainly work from home? Pick all that apply.',
    //       options: [
    //         { id: 'stroud', text: 'Stroud' }, { id: 'bristol', text: 'Bristol' },
    //         { id: 'cots', text: 'Cotswold' }, { id: 'chelt', text: 'Cheltenham' },
    //         { id: 'london', text: 'London' }, { id: 'brighton', text: 'Brighton & Hove' },
    //       ],
    //       answer: ['london', 'brighton'],
    //       note: 'Brighton 42.7% · London 42.1% · Cotswold 39.1% · Bristol 38.6% · Cheltenham 36.7% · Stroud 35.0%',
    //     },
    //     {
    //       id: 'r2q6', type: 'choice', points: 10, timeLimit: 25,
    //       prompt: 'Green Stroud! What share of Stroud\'s workers cycle to work?',
    //       options: [
    //         { id: 'a', text: '1.4%' }, { id: 'b', text: '3.0%' },
    //         { id: 'c', text: '5.2%' }, { id: 'd', text: '8.0%' },
    //       ],
    //       answer: 'a',
    //       note: '1.4%, below England\'s 2.1%. Bristol tops the group at 5.2%. The hills win.',
    //     },
    //     {
    //       id: 'r2q7', type: 'match', points: 12, timeLimit: 45,
    //       prompt: 'Match each place to its share of households with no car.',
    //       left: [
    //         { id: 'stroud', text: 'Stroud' }, { id: 'bristol', text: 'Bristol' },
    //         { id: 'brighton', text: 'Brighton & Hove' }, { id: 'london', text: 'London' },
    //       ],
    //       right: [
    //         { id: 'p12', text: '11.9%' }, { id: 'p26', text: '26.2%' },
    //         { id: 'p37', text: '37.4%' }, { id: 'p42', text: '42.1%' },
    //       ],
    //       answer: { stroud: 'p12', bristol: 'p26', brighton: 'p37', london: 'p42' },
    //       note: 'England overall: 23.5%. Cotswold is even lower than Stroud at 11.0%.',
    //     },
    //     {
    //       id: 'r2q8', type: 'choice', points: 10, timeLimit: 25,
    //       prompt: 'True or false: Stroud\'s "Other religion" share (where Pagans write themselves in) is more than double England\'s.',
    //       options: [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }],
    //       answer: 'f',
    //       note: 'False! Stroud 0.7% vs England 0.6%. The alternative reputation barely shows in the census.',
    //     },
    //   ],
    // },
    // ------------------------------------------------------------------
    {
      id: 'r3',
      title: 'Photo Reveal',
      intro: 'We start zoomed right in. The sooner you lock in, the more points you get.',
      questions: [
        {
          id: 'r3q1', type: 'reveal', points: 15, timeLimit: 60,
          prompt: 'What are we looking at?',
          media: 'media:subscription-rooms.jpg', focus: { x: 0.5, y: 0.45 }, stages: 5,
          options: [
            { id: 'a', text: 'Subscription Rooms' }, { id: 'b', text: 'Lansdown Hall' },
            { id: 'c', text: 'Stroud Library' }, { id: 'd', text: 'Ebley Mill' },
          ],
          answer: 'a',
          note: 'The Subscription Rooms, built 1833.',
        },
        {
          id: 'r3q2', type: 'reveal', points: 15, timeLimit: 60,
          prompt: 'Where is this?',
          media: 'media:woodchester-mansion.jpg', focus: { x: 0.5, y: 0.4 }, stages: 5,
          accept: ['Woodchester Mansion', 'Woodchester', 'Woodchester Park'],
          answer: 'Woodchester Mansion',
          note: 'Woodchester Mansion: unfinished since 1873.',
        },
        {
          id: 'r3q3', type: 'reveal', points: 15, timeLimit: 60,
          prompt: 'What are we looking at?',
          media: 'media:painswick-yews.jpg', focus: { x: 0.5, y: 0.5 }, stages: 5,
          options: [
            { id: 'a', text: 'Painswick churchyard yews' }, { id: 'b', text: 'Westonbirt Arboretum' },
            { id: 'c', text: 'Stratford Park' }, { id: 'd', text: 'Painswick Rococo Garden maze' },
          ],
          answer: 'a',
          note: 'Legend says only 99 yews will grow: the devil kills the 100th.',
        },
        {
          id: 'r3q4', type: 'reveal', points: 15, timeLimit: 60,
          prompt: 'Name this landmark.',
          media: 'media:rodborough-fort.jpg', focus: { x: 0.55, y: 0.45 }, stages: 5,
          accept: ['Rodborough Fort', 'Rodborough Castle', 'Fort George'],
          answer: 'Rodborough Fort',
          note: 'Rodborough Fort: a 1761 folly on Rodborough Common.',
        },
        {
          id: 'r3q5', type: 'reveal', points: 15, timeLimit: 60,
          prompt: 'Where is this?',
          media: 'media:ebley-mill.jpg', focus: { x: 0.5, y: 0.35 }, stages: 5,
          options: [
            { id: 'a', text: 'Dunkirk Mill' }, { id: 'b', text: 'Ebley Mill' },
            { id: 'c', text: 'Stanley Mill' }, { id: 'd', text: 'Lodgemore Mill' },
          ],
          answer: 'b',
          note: 'Ebley Mill: Stroud District Council HQ since the late 1980s.',
        },
        {
          id: 'r3q6', type: 'choice', points: 10, timeLimit: 30,
          prompt: 'Which one of these is Stroud?',
          options: [
            { id: 'a', image: 'media:town-nailsworth.jpg', text: 'A' },
            { id: 'b', image: 'media:town-stroud.jpg', text: 'B' },
            { id: 'c', image: 'media:town-tetbury.jpg', text: 'C' },
            { id: 'd', image: 'media:town-cirencester.jpg', text: 'D' },
          ],
          answer: 'b',
          note: 'A Nailsworth · B Stroud · C Tetbury · D Cirencester',
        },
      ],
    },
    // ------------------------------------------------------------------
    {
      id: 'r4',
      title: 'Stroud Stuff',
      intro: 'Matching, gaps, sliders: a lap of the Five Valleys.',
      questions: [
        {
          id: 'r4q1', type: 'match', points: 12, timeLimit: 60,
          prompt: 'Match the place to what it\'s known for.',
          left: [
            { id: 'thrupp', text: 'Thrupp' }, { id: 'slad', text: 'Slad' },
            { id: 'nails', text: 'Nailsworth' }, { id: 'pains', text: 'Painswick' },
            { id: 'wood', text: 'Woodchester' }, { id: 'ebley', text: 'Ebley' },
          ],
          right: [
            { id: 'mower', text: 'The first lawnmower' },
            { id: 'cider', text: 'Cider with Rosie' },
            { id: 'fgr', text: 'Vegan football club' },
            { id: 'yews', text: '99 yew trees' },
            { id: 'bats', text: 'Unfinished mansion full of bats' },
            { id: 'council', text: 'District council HQ in a mill' },
          ],
          answer: { thrupp: 'mower', slad: 'cider', nails: 'fgr', pains: 'yews', wood: 'bats', ebley: 'council' },
          note: 'Edwin Budding patented the lawnmower in 1830 and made it in Thrupp.',
        },
        {
          id: 'r4q2', type: 'blanks', points: 10, timeLimit: 45,
          prompt: 'Fill the gaps.',
          text: 'Jasper Conran called Stroud the "{0} of the Cotswolds"; the Evening Standard said it was "{1} with wellies".',
          blanks: [
            { options: ['Soho', 'Covent Garden', 'Camden', 'Shoreditch'], accept: ['Covent Garden'] },
            { options: ['Hampstead', 'Chelsea', 'Notting Hill', 'Brixton'], accept: ['Notting Hill'] },
          ],
          note: 'Conran also co-founded the Farmers\' Market in 1999.',
        },
        {
          id: 'r4q3', type: 'blanks', points: 10, timeLimit: 45,
          prompt: 'Type the missing words.',
          text: 'Stroud sits where {0} valleys meet, and its mills dyed army cloth Stroudwater {1}.',
          blanks: [
            { accept: ['five', '5'] },
            { accept: ['scarlet', 'red'] },
          ],
          note: 'Five Valleys: Chalford (Golden Valley), Nailsworth, Ruscombe, Slad and Painswick. Stroudwater Scarlet gave us the redcoats.',
        },
        {
          id: 'r4q4', type: 'slider', points: 10, timeLimit: 30,
          prompt: 'In what year did Edwin Budding patent the lawnmower?',
          min: 1700, max: 1950, step: 1, unit: '', answer: 1830, exact: 3, zeroAt: 60,
          note: '1830 (31 August), with John Ferrabee of Thrupp.',
        },
        {
          id: 'r4q5', type: 'slider', points: 10, timeLimit: 30,
          prompt: 'What year were Forest Green Rovers founded?',
          min: 1850, max: 2020, step: 1, unit: '', answer: 1889, exact: 3, zeroAt: 50,
          note: 'October 1889. They\'ve played at The New Lawn since 2006.',
        },
        {
          id: 'r4q6', type: 'multi', points: 12, timeLimit: 40,
          prompt: 'Stroud or not? Which of these have a genuine Stroud-area link?',
          options: [
            { id: 'hirst', text: 'Damien Hirst' }, { id: 'sade', text: 'Sade' },
            { id: 'banksy', text: 'Banksy' }, { id: 'lee', text: 'Laurie Lee' },
            { id: 'winwood', text: 'Steve Winwood' }, { id: 'cooper', text: 'Jilly Cooper' },
          ],
          answer: ['hirst', 'sade', 'lee', 'cooper'],
          note: 'Hirst has studios in Stroud and Chalford · Sade moved near Stroud · Laurie Lee was born in Stroud · Jilly Cooper lived in Bisley. Banksy is Bristol; Winwood lives near Northleach.',
        },
        {
          id: 'r4q7', type: 'text', points: 10, timeLimit: 30,
          prompt: 'Tie-breaker: in 2024, which party became the largest on Stroud District Council for the first time?',
          accept: ['Green', 'Greens', 'Green Party', 'The Green Party'],
          answer: 'The Green Party',
          note: 'Greens 22, Labour 20, Conservative 7, Lib Dem 2 (of 51).',
        },
      ],
    },
  ],
};
