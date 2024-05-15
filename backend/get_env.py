"""
This script is intended to be run once to create a .env file with the necessary environment variables.

To run this script successfully, you must have permission to read from the specified Azure Key Vault
and be signed in to Azure CLI (https://learn.microsoft.com/en-us/cli/azure/).

Usage: python get_env.py
"""

from azure.keyvault.secrets import SecretClient
from azure.identity import DefaultAzureCredential


VAULT_NAME = "arnoldlab"
OPENAI_API_SECRET_NAME = "OpenAI-project"
DATABASE_URI_SECRET_NAME = "TestTextfocalsDBURI"

# Default values for other environment variables
DEBUG_STATUS = "False"
PORT = "19570"


def get_secret_from_keyvault(vault_name: str, secret_name: str) -> str:
    """Retrieve a secret from Azure Key Vault."""
    key_vault_url = f"https://{vault_name}.vault.azure.net"
    credential = DefaultAzureCredential()
    client = SecretClient(vault_url=key_vault_url, credential=credential)

    return client.get_secret(secret_name).value


def create_env():
    """Create a .env file with the necessary environment variables."""
    with open(".env", "w") as f:
        f.write(
            f"OPENAI_API_KEY={get_secret_from_keyvault(VAULT_NAME, OPENAI_API_SECRET_NAME)}\n"
        )
        f.write(
            f"DATABASE_URI={get_secret_from_keyvault(VAULT_NAME, DATABASE_URI_SECRET_NAME)}\n"
        )
        f.write(f"DEBUG={DEBUG_STATUS}\n")
        f.write(f"PORT={PORT}\n")


if __name__ == "__main__":
    create_env()
    print("Successfully created .env file")
