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
                    string(credentialsId: 'POSTHOG_SOURCEMAP_KEY', variable: 'POSTHOG_SOURCEMAP_KEY'),
                    string(credentialsId: 'POSTHOG_PROJECT_TOKEN', variable: 'POSTHOG_PROJECT_TOKEN')
                ]) {
                    sh '''
                        OPENAI_API_KEY=${OPENAI_API_KEY} \
                        LOG_SECRET=${LOG_SECRET} \
                        POSTHOG_SOURCEMAP_KEY=${POSTHOG_SOURCEMAP_KEY} \
                        POSTHOG_PROJECT_TOKEN=${POSTHOG_PROJECT_TOKEN} \
                        docker compose -f docker-compose.yml -f docker-compose-prod.yml up -d
                    '''
                }
            }
        }
    }
}