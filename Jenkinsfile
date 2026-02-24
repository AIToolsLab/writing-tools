pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                echo 'Building the application...'
                sh '''
                    EXP_LOGS_GID=$(getent group writing-study-irb-approved | cut -d: -f3)
                    docker compose -f docker-compose.yml -f docker-compose-prod.yml build --build-arg EXP_LOGS_GID=${EXP_LOGS_GID}
                '''
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
                    string(credentialsId: 'Thoughtful-Study-Log-Secret', variable: 'LOG_SECRET'),
                    string(credentialsId: 'POSTHOG_API_KEY', variable: 'POSTHOG_API_KEY')
                ]) {
                    sh '''
                        OPENAI_API_KEY=${OPENAI_API_KEY} \
                        LOG_SECRET=${LOG_SECRET} \
                        POSTHOG_API_KEY=${POSTHOG_API_KEY} \
                        docker compose -f docker-compose.yml -f docker-compose-prod.yml up -d
                    '''
                }
            }
        }
    }
}