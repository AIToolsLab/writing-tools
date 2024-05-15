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


def get_keyvault(vault_name: str) -> SecretClient:
    """Retrieve the client for accessing the specified Azure Key Vault."""
    key_vault_url = f"https://{vault_name}.vault.azure.net"
    credential = DefaultAzureCredential()

    return SecretClient(vault_url=key_vault_url, credential=credential)


def create_env():
    """Create a .env file with the necessary environment variables."""
    vault = get_keyvault(VAULT_NAME)

    config = {
        "OPENAI_API_KEY": vault.get_secret(OPENAI_API_SECRET_NAME).value,
        "DATABASE_URI": vault.get_secret(DATABASE_URI_SECRET_NAME).value,
        "DEBUG": DEBUG_STATUS,
        "PORT": PORT,
    }

    with open(".env", "w") as f:
        f.write("\n".join([f"{key}={value}" for key, value in config.items()]))


if __name__ == "__main__":
    create_env()
    print("Successfully created .env file")
