import os
import logging
from openai import OpenAI
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

logger = logging.getLogger(__name__)

class HFEmbedder:
    """
    Generates embeddings locally using Hugging Face transformers.
    Optionally queries an OpenAI-compatible API if configured.
    """
    
    _tokenizer = None
    _model = None

    @classmethod
    def _initialize_model(cls):
        if cls._tokenizer is None or cls._model is None:
            model_id = os.getenv("HF_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
            logger.info(f"Loading local Hugging Face model '{model_id}'...")
            cls._tokenizer = AutoTokenizer.from_pretrained(model_id) #Downloads/loads tokenizer.
            cls._model = AutoModel.from_pretrained(model_id) #Downloads/loads the model.
            cls._model.eval() #Puts the model in evaluation mode.

    @staticmethod
    def mean_pooling(model_output, attention_mask):
        # Mean Pooling - Take attention mask into account for correct averaging
        token_embeddings = model_output[0] # First element of model_output contains all token embeddings
        input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
        return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)

    @classmethod
    def embed_batch(cls, texts: list) -> list:
        if not texts:
            return []
            
        # 1. Try OpenAI-compatible Embedding API if EMBEDDING_MODEL is configured in env
        api_key = os.getenv("LLM_API_KEY")
        base_url = os.getenv("LLM_API_BASE_URL")
        emb_model = os.getenv("EMBEDDING_MODEL")
        
        if api_key and emb_model:
            try:
                logger.info(f"Generating embeddings via OpenAI-compatible API using model '{emb_model}'...")
                client = OpenAI(api_key=api_key, base_url=base_url)
                response = client.embeddings.create(
                    input=texts,
                    model=emb_model
                )
                embeddings = [data.embedding for data in response.data]
                logger.info(f"Successfully generated {len(embeddings)} embeddings.")
                return embeddings
            except Exception as e:
                logger.warning(f"OpenAI-compatible embedding call failed: {e}. Falling back to local Hugging Face model...")

        # 2. Fallback: Local Hugging Face Model
        try:
            cls._initialize_model()
            
            # Tokenize sentences
            encoded_input = cls._tokenizer(texts, padding=True, truncation=True, return_tensors='pt')

            # Compute token embeddings
            with torch.no_grad():
                model_output = cls._model(**encoded_input)

            # Perform pooling
            sentence_embeddings = cls.mean_pooling(model_output, encoded_input['attention_mask'])

            # Normalize embeddings
            sentence_embeddings = F.normalize(sentence_embeddings, p=2, dim=1)
            
            return sentence_embeddings.tolist()
        except Exception as e:
            logger.error(f"Failed to generate local embeddings: {e}")
            
        # Hard fallback to zeros if everything fails, to prevent pipeline crash
        logger.error("All embedding integrations failed. Returning blank vector fallback.")
        # Default to 384 dimensions
        return [[0.0] * 384 for _ in texts]

    @classmethod
    def embed_text(cls, text: str) -> list:
        embeddings = cls.embed_batch([text])
        return embeddings[0] if embeddings else [0.0] * 384
