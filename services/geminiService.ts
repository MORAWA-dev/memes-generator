
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { Meme } from "../types";

export async function generateMemeSound(prompt: string): Promise<string | undefined> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("Failed to generate meme sound:", error);
    return undefined;
  }
}

export async function generateNewMemeDeck(): Promise<Meme[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Generate 12 viral, trending, or classic internet meme soundboard items. Include labels, relevant emojis, and descriptive prompts for a TTS engine to speak the meme perfectly. Mix classic 2010s memes with 2024 brainrot and viral TikTok trends. Assign a distinct color class from: bg-slate-700, bg-pink-600, bg-red-600, bg-blue-500, bg-yellow-500, bg-orange-600, bg-indigo-700, bg-amber-600, bg-emerald-600, bg-purple-700, bg-lime-600, bg-rose-400.",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              label: { type: Type.STRING },
              prompt: { type: Type.STRING },
              emoji: { type: Type.STRING },
              color: { type: Type.STRING },
            },
            required: ["id", "label", "prompt", "emoji", "color"],
          },
        },
      },
    });

    const text = response.text;
    if (text) {
      return JSON.parse(text);
    }
    throw new Error("Empty response from AI");
  } catch (error) {
    console.error("Failed to generate meme deck:", error);
    return [];
  }
}
