// Ground truth was transcribed from rendered pages, not copied from extractor output.
const corpus = 'https://raw.githubusercontent.com/ocrmypdf/OCRmyPDF/64d999aea85a672b51d83747f0b567907d7b38bd/tests/resources'

export const sources = {
  book: {
    url: `${corpus}/c03-29.pdf`,
    sha256: 'c2ff83af7d028c95209cc7eebdf80fd5bb4cd292973ed6601e4bab7d1929f201'
  },
  skew: {
    url: `${corpus}/skew.pdf`,
    sha256: '6be6b54d49df71351974774404e299b756d8d3cbeb2c4a31f15fae8dd983d72f'
  },
  attention: {
    url: 'https://arxiv.org/pdf/1706.03762',
    sha256: 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697'
  },
  columns: {
    url: 'https://aclanthology.org/2024.tacl-1.9.pdf',
    sha256: 'f37f6fabe0fe0d8c73b67579cd115dbf14e282cfb7b7af655ae8109638402c9b'
  },
  mixed: { fixture: [{ text: 'NATIVE LABEL', scan: 'SCANNED VALUE 9361' }] }
}

export const cases = [
  {
    id: 'book-page', source: 'book', page: 1,
    probes: ['Miss Watson', 'fish-line', 'spiritual gifts']
  },
  {
    id: 'book-paragraph', source: 'book', page: 1,
    crop: { x: 0.018, y: 0.722, width: 0.975, height: 0.265 },
    expectedText: `I set down, one time, back in the woods, and had a long think about it. I
      says to myself, if a body can get anything they pray for, why don't Deacon
      Winn get back the money he lost on pork? Why can't the widow get back
      her silver snuff-box that was stole? Why can't Miss Watson fat up? No, says
      I to myself, there ain't nothing in it. I went and told the widow about it,
      and she said the thing a body could get by praying for it was spiritual gifts.
      This was too many for me, but she told me what she meant—I must help
      other people, and do everything I could for other people, and look out for them
      all the time, and never think about myself. This was including Miss Watson,`
  },
  {
    id: 'skew-page', source: 'skew', page: 1,
    probes: ['32 Track MIDI Sequence Recorder', '100,000', '16 MIDI channels', 'TEMPO CHANGES', 'ANY TIME SIGNATURE'],
    orderedAnchors: ['Recording a Sequence', 'To erase a wrong note', 'Creating a Song', 'Composition Without Compromise', 'Additional Features']
  },
  {
    id: 'mixed-page', source: 'mixed', page: 1,
    expectedText: 'NATIVE LABEL SCANNED VALUE 9361',
    probes: ['NATIVE LABEL', 'SCANNED VALUE 9361']
  },
  {
    id: 'columns-page', source: 'columns', page: 2,
    orderedAnchors: ['We first experiment', 'We find that changing', 'For example', 'Given that large language models', 'To better understand']
  },
  {
    id: 'table-crop', source: 'attention', page: 8,
    crop: { x: 0.17, y: 0.12, width: 0.66, height: 0.19 },
    probes: ['23.75', '39.92', '25.16', '40.46', '26.03', '40.56', '27.3', '38.1', '28.4', '41.8'],
    manualChecks: ['Blank cells keep their column identity', 'Training-cost exponents remain attached', 'Merged cost cells retain scope']
  },
  {
    id: 'equation-crop', source: 'attention', page: 4,
    crop: { x: 0.35, y: 0.58, width: 0.48, height: 0.042 },
    manualChecks: ['Attention(Q,K,V) = softmax(Q K^T / sqrt(d_k)) V', 'Transpose, fraction, square root and subscript retain their relationships']
  }
]
