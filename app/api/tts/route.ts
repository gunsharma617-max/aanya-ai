import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime = "nodejs";

const TTS_MODEL =
  "gemini-3.1-flash-tts-preview";

const DEFAULT_VOICE = "Leda";

const AANYA_VOICE_STYLE = `
Speak as Aanya, a young adult Indian female personal AI assistant.

Voice personality:
- warm and natural
- intelligent and confident
- calm and friendly
- slightly soft and smooth
- natural Indian English and Hindi pronunciation
- conversational, not robotic
- youthful but not childish
- never overly cute, flirty, or dramatic
- use natural pauses
- comfortable speaking pace
- clear pronunciation
- natural conversational delivery

Important:
Use the requested Gemini voice exactly.
Do not imitate another voice.
Do not change the speaker identity.

Read the provided text exactly as written.
Do not add, remove, translate, or paraphrase anything.
`;

export async function POST(
  req: NextRequest
) {
  try {
    const body =
      await req.json();

    const text =
      typeof body?.text ===
      "string"
        ? body.text.trim()
        : "";

    const voice =
      typeof body?.voice ===
        "string" &&
      body.voice.trim()
        ? body.voice.trim()
        : DEFAULT_VOICE;

    if (!text) {
      return NextResponse.json(
        {
          error:
            "Text is required.",
        },
        {
          status: 400,
        }
      );
    }

    const apiKey =
      process.env.AI_API_KEY;

    if (!apiKey) {
      console.error(
        "AI_API_KEY is not set."
      );

      return NextResponse.json(
        {
          error:
            "AI_API_KEY is not configured.",
        },
        {
          status: 500,
        }
      );
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${TTS_MODEL}:generateContent?key=${apiKey}`;

    const upstream =
      await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        /*
         * Important:
         * cancelling /api/tts now also
         * cancels the Gemini TTS request.
         */
        signal:
          req.signal,

        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    `${AANYA_VOICE_STYLE}\n\n` +
                    `Text to speak:\n${text}`,
                },
              ],
            },
          ],

          generationConfig: {
            responseModalities: [
              "AUDIO",
            ],

            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
        }),
      });

    if (!upstream.ok) {
      const detail =
        await upstream.text();

      console.error(
        "Gemini TTS error:",
        upstream.status,
        detail
      );

      return NextResponse.json(
        {
          error:
            "Gemini TTS request failed.",
          status:
            upstream.status,
          detail,
        },
        {
          status: 502,
        }
      );
    }

    const data =
      await upstream.json();

    const audioBase64 =
      data?.candidates?.[0]
        ?.content?.parts
        ?.find(
          (
            part: {
              inlineData?: {
                data?: string;
              };
            }
          ) =>
            typeof part
              ?.inlineData
              ?.data ===
            "string"
        )
        ?.inlineData
        ?.data;

    if (!audioBase64) {
      console.error(
        "No audio returned by Gemini TTS:",
        data
      );

      return NextResponse.json(
        {
          error:
            "No audio was returned by Gemini TTS.",
        },
        {
          status: 502,
        }
      );
    }

    const pcm =
      Buffer.from(
        audioBase64,
        "base64"
      );

    const wav =
      pcmToWav(
        pcm,
        24000,
        1,
        16
      );

    return new NextResponse(
      new Uint8Array(wav),
      {
        status: 200,

        headers: {
          "Content-Type":
            "audio/wav",

          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    if (
      req.signal.aborted ||
      (error instanceof Error &&
        error.name ===
          "AbortError")
    ) {
      return new Response(
        null,
        {
          status: 499,
        }
      );
    }

    console.error(
      "TTS route failure:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unable to generate Aanya's voice.",
      },
      {
        status: 500,
      }
    );
  }
}

/* ==============================
   PCM → WAV
================================ */

function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const header =
    Buffer.alloc(44);

  const byteRate =
    sampleRate *
    channels *
    (bitsPerSample / 8);

  const blockAlign =
    channels *
    (bitsPerSample / 8);

  header.write(
    "RIFF",
    0
  );

  header.writeUInt32LE(
    36 + pcm.length,
    4
  );

  header.write(
    "WAVE",
    8
  );

  header.write(
    "fmt ",
    12
  );

  header.writeUInt32LE(
    16,
    16
  );

  header.writeUInt16LE(
    1,
    20
  );

  header.writeUInt16LE(
    channels,
    22
  );

  header.writeUInt32LE(
    sampleRate,
    24
  );

  header.writeUInt32LE(
    byteRate,
    28
  );

  header.writeUInt16LE(
    blockAlign,
    32
  );

  header.writeUInt16LE(
    bitsPerSample,
    34
  );

  header.write(
    "data",
    36
  );

  header.writeUInt32LE(
    pcm.length,
    40
  );

  return Buffer.concat([
    header,
    pcm,
  ]);
}
