pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                echo 'Building the application...'
                sh 'docker compose -f docker-compose.yml -f docker-compose-prod.yml build'
            }
        }
        // stage('Test') {
        //     steps {
        //         echo 'Running tests...'
        //         sh 'docker-compose run backend pytest'
        //     }
        // }
        // stage('Lint') {
        //     steps {
        //         echo 'Running linters...'
        //         sh 'docker-compose run backend flake8 backend'
        //     }
        // }
        stage('Deploy') {
            when {
                anyOf {
                    branch 'main'
                }
            }
            steps {
                echo 'Deploying the application...'
                withCredentials([
                    string(credentialsId: 'OpenAI-API-Key-Thoughtful', variable: 'OPENAI_API_KEY'),
                    string(credentialsId: 'Thoughtful-Study-Log-Secret', variable: 'LOG_SECRET')
                ]) {
                    sh 'OPENAI_API_KEY=${OPENAI_API_KEY} LOG_SECRET=${LOG_SECRET} docker compose -f docker-compose.yml -f docker-compose-prod.yml up -d'
                }
            }
        }
    }
}