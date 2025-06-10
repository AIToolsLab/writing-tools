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
                withCredentials([string(credentialsId: 'OpenAI-API-Key-Thoughtful', variable: 'OPENAI_API_KEY')]) {
                    sh 'OPENAI_API_KEY=${OPENAI_API_KEY} docker compose -f docker-compose.yml -f docker-compose-prod.yml up -d'
                }
                echo 'Testing deployment...'
                script {
                    // Wait for Docker services to be running
                    echo 'Waiting for services to be running...'
                    timeout(time: 2, unit: 'MINUTES') {
                        waitUntil {
                            script {
                                def status = sh(
                                    script: 'docker compose -f docker-compose.yml -f docker-compose-prod.yml ps --services --filter "status=running" | wc -l',
                                    returnStdout: true
                                ).trim()
                                def totalServices = sh(
                                    script: 'docker compose -f docker-compose.yml -f docker-compose-prod.yml ps --services | wc -l',
                                    returnStdout: true
                                ).trim()
                                echo "Running services: ${status}/${totalServices}"
                                if (status == totalServices) {
                                    return true
                                } else {
                                    sleep 2  // Wait 2 seconds before next check
                                    return false
                                }
                            }
                        }
                    }
                    echo 'All services are running, testing HTTP endpoint...'
                    // Test if we can fetch index.html from the deployed server
                    def response = sh(
                        script: 'curl -f -s -o /dev/null -w "%{http_code}" http://localhost:19571/',
                        returnStdout: true
                    ).trim()
                    if (response == '200') {
                        echo 'Deployment test passed: Server is responding with HTTP 200'
                    } else {
                        error "Deployment test failed: Server responded with HTTP ${response}"
                    }
                }
            }
        }
    }
}