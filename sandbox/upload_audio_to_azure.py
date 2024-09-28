'''
Upload extracted audio from a video file to Azure Blob Storage

This script extracts the audio from a video file and uploads it to Azure Blob Storage.

Required packages:
- ffmpeg-python (https://pypi.org/project/ffmpeg-python/)
- azure-storage-blob (https://pypi.org/project/azure-storage-blob/)
'''

import ffmpeg
import os
from azure.storage.blob import BlobServiceClient, BlobClient, ContainerClient
import tempfile
import argparse

def get_audio_codec(input_video):
    probe = ffmpeg.probe(input_video)
    audio_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'audio'), None)
    if audio_stream:
        return audio_stream['codec_name']
    return None

def extract_audio(input_video, output_audio):
    stream = ffmpeg.input(input_video)
    stream = ffmpeg.output(stream, output_audio, acodec='copy')
    ffmpeg.run(stream)

def upload_to_azure(file_path, connection_string, container_name, blob_name):
    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    container_client = blob_service_client.get_container_client(container_name)
    blob_client = container_client.get_blob_client(blob_name)

    with open(file_path, "rb") as data:
        blob_client.upload_blob(data)

def main():
    parser = argparse.ArgumentParser(description="Extract audio from video and upload to Azure Storage.")
    parser.add_argument("input_video", help="Path to the input video file")
    parser.add_argument("--connection-string", required=True, help="Azure Storage account connection string")
    parser.add_argument("--container-name", required=True, help="Azure Storage container name")
    parser.add_argument("--output-name", help="Name for the output blob (default: input filename with new extension)")
    args = parser.parse_args()

    # Get the audio codec
    audio_codec = get_audio_codec(args.input_video)
    if not audio_codec:
        print("No audio stream found in the video.")
        return

    # Determine the appropriate file extension
    extension_map = {
        'aac': '.aac',
        'mp3': '.mp3',
        'opus': '.opus',
        'vorbis': '.ogg',
        # Add more mappings as needed
    }
    extension = extension_map.get(audio_codec, f'.{audio_codec}')

    # Create a temporary file for the extracted audio
    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp_audio:
        temp_audio_path = temp_audio.name

    try:
        # Extract audio from video
        extract_audio(args.input_video, temp_audio_path)

        # Determine blob name
        if args.output_name:
            blob_name = args.output_name
        else:
            blob_name = os.path.basename(args.input_video).rsplit('.', 1)[0] + extension

        # Upload the extracted audio to Azure
        upload_to_azure(temp_audio_path, args.connection_string, args.container_name, blob_name)

        print(f"Audio extracted (codec: {audio_codec}) and uploaded to Azure as {blob_name}")

    finally:
        # Clean up the temporary file
        os.unlink(temp_audio_path)

if __name__ == "__main__":
    main()