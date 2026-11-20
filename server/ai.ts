import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';
import {
  MONITORING_QUESTIONS,
  type IncidentEntry,
} from '../src/shared/constants.ts';

export interface GeneratedPhotoObservation {
  caption: string;
  suggestedLocation: string;
}

export interface ExtractedReportInfo {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  hasIncident: 'Ya' | 'Tidak' | '';
  incidents: IncidentEntry[];
  extraOfficers: string;
  handoverNote: string;
  observationSummary: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Kunci API Gemini (GEMINI_API_KEY) belum dikonfigurasikan pada pelayan. Sila tetapkannya dalam Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generatePhotoObservationFromBuffer(
  imageBuffer: Buffer,
  slotNumber: number,
  displayTime: string
): Promise<GeneratedPhotoObservation> {
  const ai = getGeminiClient();

  // Prepare a compact upright JPEG for fast multimodal inspection
  const preparedBuffer = await sharp(imageBuffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const prompt = `Anda membantu guru bertugas sentri malam bagi Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026 (Slot ${slotNumber}, ${displayTime}).
Teliti gambar yang dilampirkan dan jana pemerhatian ringkas dalam Bahasa Melayu yang formal, padat dan tepat berdasarkan apa yang benar-benar kelihatan dalam gambar sahaja.

Peraturan:
1. "caption": Tulis 1 hingga 2 ayat ringkas (maksimum 30 patah perkataan) menerangkan keadaan keselamatan, pencahayaan, khemah, laluan, atau suasana pemantauan yang kelihatan dalam gambar. Jangan reka butiran yang tiada dalam gambar.
2. "suggestedLocation": Nyatakan lokasi ringkas yang kelihatan (contoh: "Kawasan khemah", "Laluan pejalan kaki", "Kawasan tandas", "Tapak perkhemahan"). Kosongkan "" jika tidak dapat dikenal pasti.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: preparedBuffer.toString('base64'),
          },
        },
        { text: prompt },
      ],
    },
    config: {
      systemInstruction:
        'Anda ialah pembantu pelaporan pemantauan keselamatan tapak perkhemahan sekolah Malaysia dalam Bahasa Melayu baku yang ringkas dan objektif.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          caption: {
            type: Type.STRING,
            description: 'Pemerhatian ringkas 1-2 ayat dalam Bahasa Melayu.',
          },
          suggestedLocation: {
            type: Type.STRING,
            description: 'Cadangan ringkas lokasi dalam gambar atau rentetan kosong.',
          },
        },
        required: ['caption', 'suggestedLocation'],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Model tidak memulangkan pemerhatian daripada gambar.');
  }

  let parsed: Partial<GeneratedPhotoObservation>;
  try {
    parsed = JSON.parse(rawText) as Partial<GeneratedPhotoObservation>;
  } catch {
    throw new Error('Format jawapan pemerhatian daripada pelayan tidak sah.');
  }

  const caption = (parsed.caption ?? '').trim();
  const suggestedLocation = (parsed.suggestedLocation ?? '').trim();
  if (!caption) {
    throw new Error('Pemerhatian ringkas tidak dapat dijana daripada gambar ini.');
  }

  return { caption, suggestedLocation };
}

export async function extractReportInfoFromImageBuffer(
  imageBuffer: Buffer,
  slotNumber: number,
  displayTime: string
): Promise<ExtractedReportInfo> {
  const ai = getGeminiClient();

  const preparedBuffer = await sharp(imageBuffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();

  const questionGuide = MONITORING_QUESTIONS.map(
    (q) => `${q.key}: ${q.prompt}\nPilihan sah: ${q.options.map((o) => `"${o}"`).join(' | ')}`
  ).join('\n\n');

  const prompt = `Anda membantu guru bertugas sentri malam bagi Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026 (Slot ${slotNumber}, ${displayTime}).
Teliti gambar yang dimuat naik (sama ada gambar catatan/borang pelaporan bertulis tangan/bercetak ATAU gambar situasi pemantauan di tapak perkhemahan) dan ekstrak maklumat laporan berstruktur dalam Bahasa Melayu.

Panduan pemetaan soalan Bahagian B (pilih HANYA daripada "Pilihan sah" atau pulangkan "" jika tidak jelas/tiada maklumat dalam gambar):
${questionGuide}

Peraturan:
- Jika gambar mengandungi teks catatan/jadual/borang contoh pelaporan, ekstrak jawapan dan butiran kejadian serta catatan serahan mengikut maklumat dalam gambar tersebut.
- Jika gambar ialah foto lokasi/pemantauan tapak perkhemahan, isi hanya medan yang dapat dinilai secara objektif daripada gambar (contohnya pencahayaan atau keadaan laluan/khemah) dan biarkan medan yang tidak kelihatan sebagai "".
- "hasIncident": Pulangkan "Ya" jika terdapat kejadian/masalah yang memerlukan tindakan susulan dalam gambar, "Tidak" jika tiada kejadian dilaporkan secara jelas, atau "" jika tidak pasti.
- "incidents": Senarai kejadian jika hasIncident ialah "Ya", selain itu pulangkan [].
- "observationSummary": Ringkasan 1-2 ayat dalam Bahasa Melayu tentang maklumat yang berjaya dikenal pasti daripada gambar.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: preparedBuffer.toString('base64'),
          },
        },
        { text: prompt },
      ],
    },
    config: {
      systemInstruction:
        'Anda ialah pembantu pengekstrakan maklumat laporan sentri malam sekolah Malaysia. Sentiasa patuhi senarai pilihan sah dengan tepat dan jangan reka maklumat yang tiada dalam gambar.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          q1: { type: Type.STRING },
          q2: { type: Type.STRING },
          q3: { type: Type.STRING },
          q4: { type: Type.STRING },
          q5: { type: Type.STRING },
          q6: { type: Type.STRING },
          hasIncident: { type: Type.STRING },
          incidents: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                time: { type: Type.STRING },
                location: { type: Type.STRING },
                description: { type: Type.STRING },
                actionTaken: { type: Type.STRING },
                notifiedParty: { type: Type.STRING },
                followUpAction: { type: Type.STRING },
              },
              required: [
                'time',
                'location',
                'description',
                'actionTaken',
                'notifiedParty',
                'followUpAction',
              ],
            },
          },
          extraOfficers: { type: Type.STRING },
          handoverNote: { type: Type.STRING },
          observationSummary: { type: Type.STRING },
        },
        required: [
          'q1',
          'q2',
          'q3',
          'q4',
          'q5',
          'q6',
          'hasIncident',
          'incidents',
          'extraOfficers',
          'handoverNote',
          'observationSummary',
        ],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Model tidak memulangkan maklumat daripada gambar.');
  }

  let parsed: Partial<ExtractedReportInfo>;
  try {
    parsed = JSON.parse(rawText) as Partial<ExtractedReportInfo>;
  } catch {
    throw new Error('Format maklumat yang dijana tidak sah.');
  }

  const pickValidOption = (key: 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6', val: unknown): string => {
    const qDef = MONITORING_QUESTIONS.find((q) => q.key === key);
    if (!qDef || typeof val !== 'string') return '';
    const trimmed = val.trim();
    return qDef.options.includes(trimmed) ? trimmed : '';
  };

  const hasIncident: 'Ya' | 'Tidak' | '' =
    parsed.hasIncident === 'Ya' || parsed.hasIncident === 'Tidak'
      ? parsed.hasIncident
      : '';

  const incidents: IncidentEntry[] =
    hasIncident === 'Ya' && Array.isArray(parsed.incidents)
      ? parsed.incidents
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            time: String(item.time ?? '').trim(),
            location: String(item.location ?? '').trim(),
            description: String(item.description ?? '').trim(),
            actionTaken: String(item.actionTaken ?? '').trim(),
            notifiedParty: String(item.notifiedParty ?? '').trim(),
            followUpAction: String(item.followUpAction ?? '').trim(),
          }))
      : [];

  return {
    q1: pickValidOption('q1', parsed.q1),
    q2: pickValidOption('q2', parsed.q2),
    q3: pickValidOption('q3', parsed.q3),
    q4: pickValidOption('q4', parsed.q4),
    q5: pickValidOption('q5', parsed.q5),
    q6: pickValidOption('q6', parsed.q6),
    hasIncident,
    incidents,
    extraOfficers: typeof parsed.extraOfficers === 'string' ? parsed.extraOfficers.trim() : '',
    handoverNote: typeof parsed.handoverNote === 'string' ? parsed.handoverNote.trim() : '',
    observationSummary:
      typeof parsed.observationSummary === 'string' && parsed.observationSummary.trim()
        ? parsed.observationSummary.trim()
        : 'Maklumat daripada gambar telah disemak dan dipadankan dengan ruang laporan.',
  };
}
