import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request) {
  try {
    const { imageBase64, operation, mimeType = "image/png" } = await request.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    let prompt;
    switch (operation) {
      case "ocr":
        prompt = "Extract ALL text from this document image. Preserve the original formatting as much as possible including paragraphs, headings, lists, and tables. Return only the extracted text, no commentary.";
        break;
      case "to-word":
        prompt = "Extract ALL text and content from this document image. Format the output as structured markdown with proper headings (# ## ###), paragraphs, bold/italic text, bullet lists, and tables. Preserve the document hierarchy and formatting. Return only the formatted content.";
        break;
      case "to-excel":
        prompt = "Extract ALL tabular data from this document image. Return the data as a JSON array of arrays where each inner array represents a row. If there are multiple tables, separate them with a '---TABLE_BREAK---' marker. Include headers as the first row of each table. If there's no tabular data, extract any structured data that could be presented as a table. Return ONLY the JSON data, no markdown code fences or commentary.";
        break;
      case "to-pptx":
        prompt = "Extract ALL content from this document image. For each logical section, provide a title and bullet points. Format as JSON array: [{\"title\": \"...\", \"bullets\": [\"...\", \"...\"]}]. Return ONLY the JSON data, no markdown code fences or commentary.";
        break;
      default:
        return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
    }

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: imageBase64 } },
    ]);

    const text = result.response.text();
    return NextResponse.json({ text });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json({ error: error.message || "AI processing failed" }, { status: 500 });
  }
}
