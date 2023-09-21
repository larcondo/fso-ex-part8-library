const { ApolloServer } = require('@apollo/server')
const { startStandaloneServer } = require('@apollo/server/standalone')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const jwt = require('jsonwebtoken')
require('dotenv').config()
const { GraphQLError } = require('graphql')
mongoose.set('strictQuery', false)

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('connected to MongoDB'))
  .catch( error => console.log('error connecting to MongoBD:', error.message ))

const typeDefs = `
  type Book {
    title: String!
    author: Author!
    published: Int!
    genres: [String!]!
    id: ID!
  }

  type Author {
    name: String!
    born: Int
    id: ID!
    bookCount: Int
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
  }

  type Mutation {
    addBook (
      title: String!
      author: String!
      published: Int!
      genres: [String]!
    ): Book
    editAuthor (
      name: String!
      setBornTo: Int!
    ): Author
    createUser (
      username: String!
      favoriteGenre: String!
    ): User
    login (
      username: String!
      password: String!
    ): Token
  }
`

const resolvers = {
  Query: {
    bookCount: async () => Book.collection.countDocuments(),
    authorCount: async () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      const books = await Book.find({}).populate('author')
      if (!args.author && !args.genre)
        return books

      return (!args.author)
        ? books.filter( b => b.genres.includes(args.genre))
        : (!args.genre)
          ? books.filter(b => b.author.name === args.author)
          : books.filter(b => b.author.name === args.author && b.genres.includes(args.genre))
    },
    allAuthors: async () => {
      // SE PODRIA RESOLVER DE OTRA MANERA
      const authors = await Author.find({})
      const books = await Book.find({})

      return authors.map( a => {
        return {
          ...a._doc, 
          id: a._id.toString(),
          bookCount: books.filter(b => b.author.toString() === a._id.toString()).length
        }
      })
    },
    me: (root, args, context) => context.currentUser
  },
  Mutation: {
    addBook: async (root, args, {currentUser}) => {
      if (!currentUser)
        throw new GraphQLError('not authenticated', {
          extensions: { code: 'BAD_USER_INPUT', }
        })
        
      const author = await Author.findOne({ name: args.author })

      const newAuthor = new Author({ name: args.author, born: null })
      if (!author) {
        try {
          await newAuthor.save()
        } catch (error) {
          throw new GraphQLError('Saving author failed', {
            extensions: {
              code: 'BAD_USER_INPUT',
              invalidArgs: args.author,
              error
            }
          })
        }
      }

      const book = new Book({ ...args, author: author ? author : newAuthor })

      try {
        await book.save()
      } catch (error) {
        throw new GraphQLError('Saving book failed', {
          extensions: {
            code: 'BAD_USER_INPUT',
            invalidArgs: args.title,
            error
          }
        })
      }

      return book
    },
    editAuthor: async (root, args, {currentUser}) => {
      if (!currentUser) 
        throw new GraphQLError('not authenticated', {
          extensions: { code: 'BAD_USER_INPUT', }
        })
      

      const author = await Author.findOne({ name: args.name })
      if (!author) return null

      try {
        author.born = args.setBornTo
        await author.save()
      } catch(error) {
        throw new GraphQLError('Updating Author failed', {
          extensions: {
            code: 'BAD_USER_INPUT',
            invalidArgs: args.setBornTo,
            error
          }
        })
      }

      return author
    },
    createUser: async (root, args) => {
      const user = new User({ 
        username: args.username,
        favoriteGenre: args.favoriteGenre
      })

      return user.save()
        .catch( error => {
          throw new GraphQLError('Creating user failed', {
            extensions: {
              code: 'BAD_USER_INPUT',
              invalidArgs: args.username,
              error
            }
          })
        })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      if (!user || args.password !== 'secret') {
        throw new GraphQLError('wrong credentials', {
          extensions: {
            code: 'BAD_USER_INPUT'
          }
        })
      }

      const userForToken = {
        username: args.username,
        id: user._id
      }

      return { value: jwt.sign(userForToken, process.env.JWT_SECRET)}
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
})

startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async ({ req, res }) => {
    const auth = req ? req.headers.authorization : null
    if (auth && auth.startsWith('Bearer ')) {
      const decodedToken = jwt.verify(auth.substring(7), process.env.JWT_SECRET)
      const currentUser = await User.findById(decodedToken.id)
      return { currentUser }
    }
  }
}).then(({ url }) => {
  console.log(`Server ready at ${url}`)
})