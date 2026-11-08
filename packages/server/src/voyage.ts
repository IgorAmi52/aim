import { configuration } from "./configuration";
import { embeddingDimensions } from "./database/schema";

async function callVoyage<Response>(endpoint: string, body: object): Promise<Response> {
  const response = await fetch(`https://api.voyageai.com/v1/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuration.VOYAGE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Voyage ${endpoint} request failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as Response;
}

export async function embedTexts(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const response = await callVoyage<{ data: Array<{ index: number; embedding: number[] }> }>("embeddings", {
    model: configuration.AIM_EMBEDDING_MODEL,
    input: texts,
    input_type: inputType,
    output_dimension: embeddingDimensions,
  });
  return response.data.sort((first, second) => first.index - second.index).map((item) => item.embedding);
}

export async function embedText(text: string, inputType: "document" | "query"): Promise<number[]> {
  const [embedding] = await embedTexts([text], inputType);
  return embedding;
}

export async function rerankDocuments(query: string, documents: string[], topCount: number): Promise<number[]> {
  const response = await callVoyage<{ data: Array<{ index: number; relevance_score: number }> }>("rerank", {
    model: configuration.AIM_RERANK_MODEL,
    query,
    documents,
    top_k: topCount,
  });
  return response.data.map((item) => item.index);
}
